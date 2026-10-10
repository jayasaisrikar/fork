/**
 * Phase 1 spike against the real ArmorIQ service (build spec 8.1).
 *
 *   pnpm spike            # runs S0..S9 in order
 *   pnpm spike S1 S2      # runs only those
 *
 * Each spike prints the raw SDK result or exception and appends a row to docs/FINDINGS.md.
 * Nothing here is mocked. S4 waits for a human to approve a hold; S6 sleeps 70 seconds.
 */
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ArmorIQClient, type IntentToken, type McpCredentialMap } from '@armoriq/sdk';

const TREASURY = 'treasury-mcp';
const PAYMENTS = 'payments-mcp';
const FINDINGS = new URL('../../docs/FINDINGS.md', import.meta.url);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Fill it in .env (see .env.example).`);
  return value;
}

const userEmail = env('DEMO_CFO_EMAIL');
const mcpSecret = env('FORK_MCP_SECRET');
const mcpCredentials: McpCredentialMap = {
  [TREASURY]: { authType: 'api_key', apiKey: mcpSecret, headerName: 'X-Fork-Secret' },
  [PAYMENTS]: { authType: 'api_key', apiKey: mcpSecret, headerName: 'X-Fork-Secret' },
};

function makeClient(apiKey = env('ARMORIQ_API_KEY')) {
  return new ArmorIQClient({
    apiKey,
    agentId: process.env.ARMORIQ_AGENT_ID || undefined,
    userId: process.env.ARMORIQ_USER_ID || undefined,
    mcpCredentials,
  });
}

type Step = { action: string; mcp: string; params: Record<string, unknown> };

async function mint(client: ArmorIQClient, goal: string, steps: Step[], validitySeconds = 600) {
  const capture = client.capturePlan('fork-spike', goal, { goal, steps });
  const token = await client.getIntentToken(capture, undefined, validitySeconds);
  console.log('token:', {
    tokenId: token.tokenId,
    planId: token.planId,
    planHash: token.planHash,
    merkleRoot: token.rawToken?.merkle_root,
    expiresAt: token.expiresAt,
    stepProofs: token.stepProofs?.length,
    totalSteps: token.totalSteps,
  });
  return token;
}

const pay = (vendorId: string, amount: number) => ({
  vendorId,
  billId: 'B-SPIKE',
  amount,
  currency: 'USD',
  idempotencyKey: randomUUID(),
});

const call = (
  client: ArmorIQClient,
  mcp: string,
  action: string,
  token: IntentToken,
  params: Record<string, unknown> = {},
) => client.invokeWithPolicy(mcp, action, token, params, { userEmail });

/** Everything inspectable about a thrown value, without assuming its class. */
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
  /** Outcome names that count as the expected result. 'resolved' means the call returned. */
  pass?: string[];
  run: () => Promise<unknown>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const spikes: Spike[] = [
  {
    id: 'S0',
    test: 'Construct the client per the installed types',
    expected: 'No exception',
    pass: ['resolved'],
    run: async () => {
      makeClient();
      return 'constructed';
    },
  },
  {
    id: 'S1',
    test: 'Plan [get_balance]; invoke it',
    expected: 'Success; call visible in ArmorIQ Observability',
    pass: ['resolved'],
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S1 read balance', [
        { action: 'get_balance', mcp: TREASURY, params: {} },
      ]);
      return call(client, TREASURY, 'get_balance', token);
    },
  },
  {
    id: 'S2',
    test: 'Same plan; invoke list_vendors (not in plan)',
    expected: 'IntentMismatchException',
    pass: ['IntentMismatchException'],
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S2 read balance only', [
        { action: 'get_balance', mcp: TREASURY, params: {} },
      ]);
      return call(client, TREASURY, 'list_vendors', token);
    },
  },
  {
    id: 'S3',
    test: 'Plan pay_vendor {v_harbor, 100}; invoke with {v_sertao, 100}',
    expected: 'Record what happens (are params bound?)',
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S3 pay harbor 100', [
        { action: 'pay_vendor', mcp: PAYMENTS, params: pay('v_harbor', 100) },
      ]);
      return call(client, PAYMENTS, 'pay_vendor', token, pay('v_sertao', 100));
    },
  },
  {
    id: 'S4',
    test: 'Plan pay_vendor amount 16000; invokeWithPolicy with waitForApproval',
    expected: 'Hold with a delegationId; resolves after a human approves',
    pass: ['resolved', 'PolicyHoldException'],
    run: async () => {
      const client = makeClient();
      const params = pay('v_sertao', 16000);
      const token = await mint(client, 'S4 pay sertao 16000', [
        { action: 'pay_vendor', mcp: PAYMENTS, params },
      ]);
      return client.invokeWithPolicy(PAYMENTS, 'pay_vendor', token, params, {
        userEmail,
        waitForApproval: true,
        delegationTimeoutMs: 180_000,
        onHold: (info) => {
          console.log('onHold:', info);
          if (info.delegationId) {
            console.log('>>> HUMAN: approve this hold in platform.armoriq.ai within 3 minutes.');
          }
        },
      });
    },
  },
  {
    id: 'S5',
    test: 'Plan includes send_wire; invoke it',
    expected: 'PolicyBlockedException',
    pass: ['PolicyBlockedException'],
    run: async () => {
      const client = makeClient();
      const params = { accountNumber: '000123457781', routingNumber: '110000000', amount: 50 };
      const token = await mint(client, 'S5 send wire', [
        { action: 'send_wire', mcp: PAYMENTS, params },
      ]);
      return call(client, PAYMENTS, 'send_wire', token, params);
    },
  },
  {
    id: 'S6',
    test: 'Token with validitySeconds 60; wait 70s; invoke',
    expected: 'TokenExpiredException',
    pass: ['TokenExpiredException'],
    run: async () => {
      const client = makeClient();
      const token = await mint(
        client,
        'S6 short token',
        [{ action: 'get_balance', mcp: TREASURY, params: {} }],
        60,
      );
      console.log('waiting 70s for the token to expire...');
      await sleep(70_000);
      return call(client, TREASURY, 'get_balance', token);
    },
  },
  {
    id: 'S7',
    test: 'Plan pay_vendor to an unapproved vendor ID (v_unknown)',
    expected: 'Block via recipient validation',
    pass: ['PolicyBlockedException'],
    run: async () => {
      const client = makeClient();
      const params = pay('v_unknown', 50);
      const token = await mint(client, 'S7 pay unknown vendor', [
        { action: 'pay_vendor', mcp: PAYMENTS, params },
      ]);
      return call(client, PAYMENTS, 'pay_vendor', token, params);
    },
  },
  {
    id: 'S8',
    test: 'Invalid API key',
    expected: 'ConfigurationException or an auth error; never a result',
    run: async () => {
      const client = makeClient('ak_test_invalid_fork_spike_key');
      const token = await mint(client, 'S8 bad key', [
        { action: 'get_balance', mcp: TREASURY, params: {} },
      ]);
      return call(client, TREASURY, 'get_balance', token);
    },
  },
  {
    id: 'S9',
    test: 'Plan treasury-mcp.get_balance; invoke get_balance on payments-mcp (wrong MCP)',
    expected: 'Record what happens (is the mcp field bound?)',
    run: async () => {
      const client = makeClient();
      const token = await mint(client, 'S9 read balance', [
        { action: 'get_balance', mcp: TREASURY, params: {} },
      ]);
      return call(client, PAYMENTS, 'get_balance', token);
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
    raw = describeError(error);
    outcome = (raw as { name: string }).name;
    console.log('EXCEPTION:', JSON.stringify(raw, null, 2));
  }

  // S8 passes on any exception: the only failure is a call that returns.
  const passed = spike.id === 'S8' ? outcome !== 'resolved' : spike.pass?.includes(outcome);
  const conclusion =
    spike.pass || spike.id === 'S8' ? (passed ? 'PASS' : 'FAIL') : 'RECORDED (needs reading)';
  const rawText = JSON.stringify(raw) ?? 'undefined';
  const trimmed = rawText.length > 400 ? `${rawText.slice(0, 400)}…` : rawText;
  appendFileSync(
    FINDINGS,
    `| ${spike.id} (${new Date().toISOString()}) | ${cell(spike.test)} | ${cell(spike.expected)} | ${outcome} | \`${cell(trimmed).replace(/`/g, "'")}\` | ${conclusion} |\n`,
  );
  console.log(`----- ${spike.id}: ${outcome} → ${conclusion}`);
}

const wanted = process.argv.slice(2).map((id) => id.toUpperCase());
const unknown = wanted.filter((id) => !spikes.some((spike) => spike.id === id));
if (unknown.length) throw new Error(`Unknown spike: ${unknown.join(', ')}`);

for (const spike of spikes) {
  if (wanted.length === 0 || wanted.includes(spike.id)) await runSpike(spike);
}
