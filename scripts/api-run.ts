// drives a whole run through the engine API, no UI: sign in, fixture branches, simulate,
// authorize B, tamper test, commit, then print what happened.
//   pnpm api-run            (engine and MCP must be running)
const BASE = process.env.ENGINE_URL ?? `http://localhost:${process.env.ENGINE_PORT ?? 8790}`;

let cookie = '';
let csrf = '';

async function call<T = Record<string, never>>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0] ?? '';
  const json = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(json)}`);
  return json as T;
}

interface Branch {
  id: string;
  label: string;
  status: string;
  projection?: { cashAfterCents: number };
}
interface Step {
  origin: string;
  stepIndex: number | null;
  tool: string;
  verdict: string | null;
  source: string | null;
  errorClass: string | null;
  status: string;
  receiptId: string | null;
  delegationId: string | null;
}
interface RunView {
  run: { id: number };
  branches: Branch[];
  steps: Step[];
  executions: { kind: string; armorPlanId: string; armorPlanHash: string; tokenId: string }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dollars = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US')}`;

const login = await call<{ csrfToken: string }>('POST', '/api/auth/login', {
  email: process.env.CFO_EMAIL,
  password: process.env.CFO_PASSWORD,
});
csrf = login.csrfToken;

console.log('health:', JSON.stringify(await call('GET', '/api/health')));

const { run } = await call<RunView>('POST', '/api/runs');
const proposed = await call<{ branches: Branch[] }>(
  'POST',
  '/api/demo/fixture-branches',
  { runId: run.id },
  { 'x-admin-key': process.env.DEMO_ADMIN_KEY ?? '' },
);
for (const branch of proposed.branches) {
  const { branch: simulated } = await call<{ branch: Branch }>(
    'POST',
    `/api/branches/${branch.id}/simulate`,
  );
  console.log(
    `branch ${simulated.label}: ${simulated.status}, cash after ${dollars(simulated.projection?.cashAfterCents ?? 0)}`,
  );
}

const b = proposed.branches.find((branch) => branch.label === 'B')!;
const authorized = await call<{ approvedPlanHash: string }>(
  'POST',
  `/api/branches/${b.id}/authorize`,
);
console.log('authorized B, plan hash', authorized.approvedPlanHash);

if (!process.argv.includes('--no-tamper')) {
  const tamper = await call<{ steps: Step[] }>('POST', `/api/branches/${b.id}/tamper-test`);
  console.log('\ntamper test (deliberate):');
  console.table(
    tamper.steps.map(({ tool, verdict, source, errorClass, status }) => ({
      tool,
      verdict,
      source,
      errorClass,
      status,
    })),
  );
}

await call('POST', `/api/branches/${b.id}/commit`);
console.log(
  'commit started. if a payment is held, approve it on platform.armoriq.ai (Intent -> Held Actions).',
);

let view: RunView;
let announced = '';
for (;;) {
  await sleep(2000);
  view = await call<RunView>('GET', `/api/runs/${run.id}`);
  const held = view.steps.find((step) => step.status === 'HELD' && step.delegationId);
  if (held && announced !== held.delegationId) {
    announced = held.delegationId ?? '';
    console.log(`>>> HELD: ${held.tool}, delegation ${held.delegationId}. waiting for approval...`);
  }
  if (view.branches.find((branch) => branch.id === b.id)?.status !== 'COMMITTING') break;
}

console.log(`\nbranch B: ${view.branches.find((branch) => branch.id === b.id)?.status}`);
console.table(
  view.steps
    .filter((step) => step.origin === 'runner')
    .map(({ stepIndex, tool, verdict, source, errorClass, status, receiptId }) => ({
      stepIndex,
      tool,
      verdict,
      source,
      errorClass,
      status,
      receipt: receiptId?.slice(0, 13),
    })),
);
console.log(
  'ArmorIQ plans:',
  view.executions.map((execution) => `${execution.kind} ${execution.armorPlanId}`).join(', '),
);
const scenario = await call<{ scenario: { cashCents: number } }>('GET', '/api/scenario');
console.log('cash now:', dollars(scenario.scenario.cashCents));

export {};
