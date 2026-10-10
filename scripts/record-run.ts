// one real run for the record: the real planner proposes, the CFO session authorizes a feasible
// branch, the fake vendor email is injected, and the commit runs through live ArmorIQ. the run view
// and its audit trail are saved as JSON for the landing page. the only edit is that the operator's
// email is swapped for a fictional one before the file is written.
//   pnpm record-run            (engine and MCP running, ledger freshly reset)
import { writeFileSync } from 'node:fs';

const BASE = process.env.ENGINE_URL ?? `http://localhost:${process.env.ENGINE_PORT ?? 8790}`;
const OUT = new URL('../apps/web/data/recorded-run.json', import.meta.url);

let cookie = '';
let csrf = '';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
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
  title: string;
  status: string;
  risk?: { approvalsNeeded: number };
}
interface View {
  run: { id: number };
  branches: Branch[];
  steps: {
    origin: string;
    tool: string;
    verdict: string | null;
    source: string | null;
    errorClass: string | null;
    status: string;
  }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

csrf = (
  await call<{ csrfToken: string }>('POST', '/api/auth/login', {
    email: process.env.CFO_EMAIL,
    password: process.env.CFO_PASSWORD,
  })
).csrfToken;

const { run } = await call<View>('POST', '/api/runs');
const { branches } = await call<{ branches: Branch[] }>('POST', `/api/runs/${run.id}/propose`);
console.log(
  `run ${run.id}: the planner proposed ${branches.map((branch) => `${branch.label} "${branch.title}"`).join(', ')}`,
);

const simulated: Branch[] = [];
for (const branch of branches)
  simulated.push(
    (await call<{ branch: Branch }>('POST', `/api/branches/${branch.id}/simulate`)).branch,
  );
const feasible = simulated.filter((branch) => branch.status === 'SIMULATED');
if (!feasible.length) throw new Error('the planner proposed nothing feasible, run it again');
// fewest holds first, so the run does not sit waiting for a human
const chosen = feasible.sort(
  (a, b) => (a.risk?.approvalsNeeded ?? 0) - (b.risk?.approvalsNeeded ?? 0),
)[0]!;

await call('POST', `/api/branches/${chosen.id}/authorize`);
await call('POST', `/api/runs/${run.id}/inject`);
await call('POST', `/api/branches/${chosen.id}/commit`);
console.log(
  `authorized and committing ${chosen.label} "${chosen.title}" with the hostile email in the inbox`,
);

let view: View;
for (;;) {
  await sleep(2000);
  view = await call<View>('GET', `/api/runs/${run.id}`);
  const status = view.branches.find((branch) => branch.id === chosen.id)?.status;
  if (status !== 'COMMITTING') {
    console.log(`branch ${chosen.label}: ${status}`);
    break;
  }
}
console.table(
  view.steps.map(({ origin, tool, verdict, source, errorClass, status }) => ({
    origin,
    tool,
    verdict,
    source,
    errorClass,
    status,
  })),
);

const audit = await call<{ events: unknown[] }>('GET', `/api/audit?run=${run.id}&limit=500`);
const record = JSON.stringify(
  {
    recordedAt: new Date().toISOString(),
    branchId: chosen.id,
    view,
    events: audit.events.reverse(),
  },
  null,
  2,
);
writeFileSync(
  OUT,
  `${record.replaceAll(process.env.CFO_EMAIL ?? '\u0000', 'cfo@kettleandpine.example')}\n`,
);
console.log(`saved ${OUT.pathname}`);

export {};
