// the live-provider suite. it talks to a running engine, which talks to real ArmorIQ.
//   pnpm reset, restart the engine and MCP, then: RUN_ARMORIQ_LIVE_TESTS=1 pnpm test:live
// without that variable every test here is reported as skipped, never as passed.
import { createGateway } from '@fork/armor-adapter';
import { cashCents, openDb, seedScenario } from '@fork/db';
import { liquidityShortfall, referenceBranches } from '@fork/domain-finance';
import { describe, expect, it } from 'vitest';
import { createEngine } from '../../apps/engine/src/service';

const env = process.env;
const live = env.RUN_ARMORIQ_LIVE_TESTS === '1';
const BASE = env.ENGINE_URL ?? `http://localhost:${env.ENGINE_PORT ?? 8790}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
let cookie = '';
let csrf = '';

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Json> {
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
  return json;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cash = async () => (await call('GET', '/api/scenario')).scenario.cashCents as number;

describe.skipIf(!live)('live ArmorIQ', () => {
  let runId: number;
  let branchB: Json;

  it('is configured, reachable and knows all eight tools', async () => {
    csrf = (
      await call('POST', '/api/auth/login', { email: env.CFO_EMAIL, password: env.CFO_PASSWORD })
    ).csrfToken;
    const health = await call('GET', '/api/health');
    expect(health).toMatchObject({
      armoriqConfigured: true,
      armoriqReachable: true,
      mcpReachable: true,
    });
    expect(health.registeredTools).toEqual(
      expect.arrayContaining([
        'execute_payment',
        'execute_large_payment',
        'update_vendor_destination',
      ]),
    );
    expect(await cash(), 'reset the ledger before running the live suite').toBe(5_000_000);
  });

  it('authorizes branch B from the reference fixture', async () => {
    runId = (await call('POST', '/api/runs')).run.id;
    const { branches } = await call(
      'POST',
      '/api/demo/fixture-branches',
      { runId },
      { 'x-admin-key': env.DEMO_ADMIN_KEY ?? '' },
    );
    for (const branch of branches) await call('POST', `/api/branches/${branch.id}/simulate`);
    branchB = branches[1];
    const { steps } = await call('POST', `/api/branches/${branchB.id}/authorize`);
    expect(steps).toHaveLength(9);
  });

  it('BLOCK: a tool outside the signed plan is refused, and an altered payment never reaches the ledger', async () => {
    const { steps } = await call('POST', `/api/branches/${branchB.id}/tamper-test`);
    expect(steps[0]).toMatchObject({
      tool: 'update_vendor_destination',
      verdict: 'block',
      source: 'armoriq',
      errorClass: 'IntentMismatchException',
    });
    expect(steps[1]).toMatchObject({
      tool: 'execute_payment',
      verdict: 'allow',
      source: 'mcp',
      errorClass: 'CAPABILITY_INVALID',
      status: 'NOT_EXECUTED',
    });
    expect(await cash()).toBe(5_000_000);
  }, 60_000);

  it('ALLOW then HOLD: payments post with receipts, and the held one writes nothing while it waits', async () => {
    await call('POST', `/api/branches/${branchB.id}/commit`);
    let view: Json;
    let held: Json;
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      view = await call('GET', `/api/runs/${runId}`);
      held = view.steps.find(
        (step: Json) => step.origin === 'runner' && step.status === 'HELD' && step.delegationId,
      );
      if (
        held ||
        view.branches.find((branch: Json) => branch.id === branchB.id).status !== 'COMMITTING'
      )
        break;
    }
    const runner = view.steps.filter((step: Json) => step.origin === 'runner');
    const harbor = runner.find((step: Json) => step.args.vendorId === 'v-harbor');
    expect(harbor).toMatchObject({
      verdict: 'allow',
      source: 'armoriq',
      status: 'EXECUTED',
      receiptId: expect.stringMatching(/^rcpt_/),
    });

    expect(held, 'the large payment should be waiting on the ArmorIQ platform').toMatchObject({
      tool: 'execute_large_payment',
      verdict: 'hold',
      receiptId: null,
    });
    const paid = view.receipts.reduce((sum: number, receipt: Json) => sum + receipt.amountCents, 0);
    expect(paid).toBe(1_800_000);
    expect(await cash()).toBe(5_000_000 - paid);
    expect(view.receipts.some((receipt: Json) => receipt.vendorId === 'v-juniper')).toBe(false);

    // what we store matches what ArmorIQ issued for this plan
    const execution = view.executions.find((item: Json) => item.kind === 'commit');
    expect(execution.armorPlanId).toMatch(/^[0-9a-f-]{36}$/);
    expect(execution.armorPlanHash).toMatch(/^[0-9a-f]{64}$/);
    console.log(`live plan ${execution.armorPlanId}, held delegation ${held.delegationId}`);
    await call('POST', `/api/branches/${branchB.id}/cancel`);
  }, 180_000);
});

describe.skipIf(!live)('live proof mode', () => {
  const probe = (attack: string) =>
    fetch(`${BASE}/api/proof/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // a host that takes probes only from its edge needs the edge's key
        ...(env.PROOF_EDGE_KEY
          ? { 'x-fork-edge-key': env.PROOF_EDGE_KEY, 'x-fork-client': 'live-suite' }
          : {}),
      },
      body: JSON.stringify({ attack }),
    });

  it('policy_blocked_tool: the platform policy blocks a forbidden tool that is in the plan', async () => {
    const response = await probe('policy_blocked_tool');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.steps[0]).toMatchObject({ armoriq: 'allow', outcome: 'executed' });
    expect(result.steps[1]).toMatchObject({
      armoriq: 'block',
      enforcedBy: 'armoriq_policy',
      errorClass: 'PolicyBlockedException',
      outcome: 'not_reached',
      matchedExpectation: true,
    });
    expect(result.ledger.sandbox.postingsAdded).toBe(0);
    expect(result.ledger.treasury.postingsAdded).toBe(0);
    console.log(`live policy block, plan ${result.armorPlanId}`);
  }, 60_000);

  it('altered_amount: ArmorIQ allows the tool and the MCP refuses the arguments', async () => {
    // the engine's cooldown applies to this suite too
    await sleep(Number(env.PROOF_COOLDOWN_SECONDS ?? 20) * 1000 + 1000);
    const response = await probe('altered_amount');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.capabilityCheck).toEqual({
      originalArguments: 'valid',
      alteredArguments: 'invalid',
    });
    expect(result.steps[1]).toMatchObject({
      armoriq: 'allow',
      enforcedBy: 'fork_mcp',
      errorClass: 'CAPABILITY_INVALID',
      outcome: 'refused',
      matchedExpectation: true,
    });
    expect(result.ledger.sandbox.postingsAdded).toBe(0);
    console.log(`live altered amount, plan ${result.armorPlanId}`);
  }, 90_000);
});

describe.skipIf(!live)('live fail-closed', () => {
  it('refuses to commit with a bad ArmorIQ key and leaves the ledger alone', async () => {
    const db = openDb(':memory:');
    seedScenario(db);
    const gateway = createGateway({
      apiKey: 'ak_test_invalid_fork_live_suite',
      mcpName: 'fork-finance-mcp',
      mcpKey: 'x',
      userEmail: 'cfo@example.test',
      requesterEmail: 'agent@example.test',
    });
    const engine = createEngine({ db, gateway, capabilitySecret: 'x' });
    const run = engine.createRun('cfo@example.test');
    const fixtures = referenceBranches(liquidityShortfall()).map(
      ({ title, rationale, allocations }) => ({ title, rationale, allocations }),
    );
    const b = engine.addBranches(run.id, { branches: fixtures }, 'fixture')[1]!;
    engine.simulateBranch(b.id);
    engine.authorizeBranch(b.id, 'cfo@example.test');

    await expect(engine.commitBranch(b.id, 'cfo@example.test')).rejects.toMatchObject({
      code: 'ARMORIQ_UNAVAILABLE',
      status: 503,
    });
    expect(cashCents(db, 'liquidity-shortfall')).toBe(5_000_000);
    expect(engine.getRun(run.id).branches.find((branch) => branch.id === b.id)?.status).toBe(
      'APPROVED',
    );
  }, 60_000);
});
