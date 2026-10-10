// pnpm spike          runs S0..S8
// pnpm spike S1 S2    runs just those
// every result is appended to docs/FINDINGS.md. S4 needs a human, S6 sleeps 70s.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createArmorClient, type ArmorClient, type IntentToken } from '@fork/armor-adapter';
import { FINANCE_MCP } from '@fork/shared';

const FINDINGS = new URL('../../docs/FINDINGS.md', import.meta.url);
const SCENARIO = 'liquidity-shortfall';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set, see .env.example`);
  return value;
}

const userEmail = env('CFO_EMAIL');

function makeClient(apiKey = env('ARMORIQ_API_KEY')) {
  const client = createArmorClient({
    apiKey,
    agentId: process.env.ARMORIQ_AGENT_ID || undefined,
    userId: process.env.ARMORIQ_USER_ID || undefined,
    mcpName: FINANCE_MCP,
    mcpKey: env('FORK_MCP_KEY'),
  });
  // the SDK flattens error bodies to "[object Object]", so print them here
  client
    ._sessionInternals()
    .httpClient.interceptors.response.use(
      (response: { status: number; data: unknown; config: { url?: string } }) => {
        if (response.status >= 400) {
          console.log(
            `HTTP ${response.status} ${response.config.url}:`,
            JSON.stringify(response.data),
          );
        }
        return response;
      },
    );
  return client;
}

type Params = Record<string, unknown>;
type Step = { action: string; params: Params };

async function mint(client: ArmorClient, goal: string, steps: Step[], validitySeconds = 600) {
  const plan = { goal, steps: steps.map((step) => ({ ...step, mcp: FINANCE_MCP })) };
  const capture = client.capturePlan('fork-spike', goal, plan);
  const token = await client.getIntentToken(capture, undefined, validitySeconds);
  console.log('token:', {
    tokenId: token.tokenId,
    planId: token.planId,
    planHash: token.planHash,
    merkleRoot: token.rawToken?.merkle_root,
    expiresAt: token.expiresAt,
    stepProofs: token.stepProofs?.length,
  });
  return token;
}

const pay = (vendorId: string, recipientId: string, dollars: number): Params => ({
  scenarioId: SCENARIO,
  vendorId,
  recipientId,
  amount: dollars,
  amountCents: dollars * 100,
  currency: 'USD',
  idempotencyKey: randomUUID(),
  approvedExecutionRef: 'spike',
});

const call = (client: ArmorClient, action: string, token: IntentToken, params: Params) =>
  client.invokeWithPolicy(FINANCE_MCP, action, token, params, { userEmail });

const balance = { action: 'get_treasury_balance', params: { scenarioId: SCENARIO } };

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { name: 'non-Error', value: error };
  const http = (error as { response?: { status?: number; data?: unknown } }).response;
  return {
    name: error.constructor.name,
    message: error.message,
    ...Object.fromEntries(Object.entries(error)),
    ...(http ? { httpStatus: http.status, httpData: http.data } : {}),
  };
}

interface Spike {
  id: string;
  test: string;
  expected: string;
  // outcomes that count as a pass, 'resolved' means the call returned. omit to just record.
  pass?: string[];
  run: () => Promise<unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const spikes: Spike[] = [
  {
    id: 'S0',
    test: 'Construct the client per the installed types',
    expected: 'OK',
    pass: ['resolved'],
    run: async () => {
      makeClient();
      return 'constructed';
    },
  },
  {
    id: 'S1',
    test: 'Plan [get_treasury_balance]; invoke',
    expected: 'Success; visible in ArmorIQ observability',
    pass: ['resolved'],
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S1 read balance', [balance]);
      return call(client, balance.action, token, balance.params);
    },
  },
  {
    id: 'S2',
    test: 'Same plan; invoke list_invoices (not in plan)',
    expected: 'IntentMismatchException',
    pass: ['IntentMismatchException'],
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S2 read balance only', [balance]);
      return call(client, 'list_invoices', token, { scenarioId: SCENARIO });
    },
  },
  {
    id: 'S3',
    test: 'Plan execute_payment to rcp-harbor $100; invoke with rcp-northline',
    expected: 'Record the response (are params bound?)',
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S3 pay harbor 100', [
        { action: 'execute_payment', params: pay('v-harbor', 'rcp-harbor', 100) },
      ]);
      return call(client, 'execute_payment', token, pay('v-northline', 'rcp-northline', 100));
    },
  },
  {
    id: 'S4',
    test: 'Plan execute_payment $12,000; invokeWithPolicy + waitForApproval',
    expected: 'Hold with a delegationId; resolves after approval',
    pass: ['resolved', 'PolicyHoldException'],
    run: async () => {
      const client = makeClient();
      const params = pay('v-juniper', 'rcp-juniper', 12000);
      const token = await mint(client, 'S4 pay juniper 12000', [
        { action: 'execute_payment', params },
      ]);
      return client.invokeWithPolicy(FINANCE_MCP, 'execute_payment', token, params, {
        userEmail,
        waitForApproval: true,
        delegationTimeoutMs: 180_000,
        onHold: (info) => {
          console.log('onHold:', info);
          if (info.delegationId)
            console.log('>>> approve this hold on platform.armoriq.ai (3 min)');
        },
      });
    },
  },
  {
    id: 'S5',
    test: 'Plan includes update_vendor_destination; invoke',
    expected: 'PolicyBlockedException',
    pass: ['PolicyBlockedException'],
    run: async () => {
      const client = makeClient();
      const params = { vendorId: 'v-northline', recipientId: 'recipient-external-999' };
      const token = await mint(client, 'S5 change destination', [
        { action: 'update_vendor_destination', params },
      ]);
      return call(client, 'update_vendor_destination', token, params);
    },
  },
  {
    id: 'S6',
    test: 'validitySeconds 60; wait 70s; invoke',
    expected: 'TokenExpiredException',
    pass: ['TokenExpiredException'],
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S6 short token', [balance], 60);
      console.log('waiting 70s for the token to expire...');
      await sleep(70_000);
      return call(client, balance.action, token, balance.params);
    },
  },
  {
    id: 'S7',
    test: 'Plan payment to an unregistered recipient',
    expected: 'Policy block',
    pass: ['PolicyBlockedException'],
    run: async () => {
      const client = makeClient();
      const params = pay('v-northline', 'recipient-external-999', 50);
      const token = await mint(client, 'S7 pay unknown recipient', [
        { action: 'execute_payment', params },
      ]);
      return call(client, 'execute_payment', token, params);
    },
  },
  {
    id: 'S8',
    test: 'Bad API key',
    expected: 'An error, never a result',
    run: async () => {
      const client = makeClient('ak_test_invalid_fork_spike_key');
      const token = await mint(client, 'S8 bad key', [balance]);
      return call(client, balance.action, token, balance.params);
    },
  },
];

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

async function runSpike(spike: Spike) {
  console.log(`\n===== ${spike.id}: ${spike.test} =====`);
  let outcome: string;
  let raw: unknown;
  try {
    raw = await spike.run();
    outcome = 'resolved';
    console.log('RESULT:', JSON.stringify(raw, null, 2));
  } catch (error) {
    const described = describeError(error);
    raw = described;
    outcome = described.name;
    console.log('EXCEPTION:', JSON.stringify(raw, null, 2));
  }

  // S8 passes on any exception, the only failure is a call that returns
  const passed = spike.id === 'S8' ? outcome !== 'resolved' : spike.pass?.includes(outcome);
  const graded = spike.pass || spike.id === 'S8';
  const conclusion = graded ? (passed ? 'PASS' : 'FAIL') : 'RECORDED, needs reading';
  const rawText = JSON.stringify(raw) ?? 'undefined';
  const trimmed = rawText.length > 400 ? `${rawText.slice(0, 400)}…` : rawText;
  const row = [
    `${spike.id} (${new Date().toISOString()})`,
    cell(spike.test),
    cell(spike.expected),
    outcome,
    `\`${cell(trimmed).replace(/`/g, "'")}\``,
    conclusion,
  ];
  appendFileSync(FINDINGS, `| ${row.join(' | ')} |\n`);
  console.log(`----- ${spike.id}: ${outcome} → ${conclusion}`);
}

const wanted = process.argv.slice(2).map((id) => id.toUpperCase());
const unknown = wanted.filter((id) => !spikes.some((spike) => spike.id === id));
if (unknown.length) throw new Error(`Unknown spike: ${unknown.join(', ')}`);

for (const spike of spikes) {
  if (wanted.length === 0 || wanted.includes(spike.id)) await runSpike(spike);
}
