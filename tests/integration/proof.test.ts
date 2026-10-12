import type { Gateway } from '@fork/armor-adapter';
import { cashCents, postEntry, schema } from '@fork/db';
import { PROOF_SCENARIO } from '@fork/domain-finance';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ATTACKS, type Attack } from '../../apps/engine/src/proof';
import { CFO, SCENARIO, world } from '../support/world';

type World = ReturnType<typeof world>;

const postings = (w: World, scenarioId: string) =>
  w.db.get<{ n: number }>(
    sql`select count(*) as n from ledger_postings where "scenarioId" = ${scenarioId}`,
  ).n;
const proofRows = (w: World) => w.db.select().from(schema.proofRuns).all();
const sandboxRuns = (w: World) =>
  w.db.select().from(schema.runs).where(eq(schema.runs.scenarioId, PROOF_SCENARIO)).all();

// a clock the test moves by hand
function clock(start = Date.now()) {
  let at = start;
  return { now: () => new Date(at), advance: (seconds: number) => (at += seconds * 1000) };
}

// wraps a gateway so one dispatch can misbehave
function wrapped(w: World, onAttack: (inner: Gateway) => Gateway['dispatch']): Gateway {
  const inner = w.gatewayFor();
  const attack = onAttack(inner);
  return {
    sign: (...args) => inner.sign(...args),
    close: (...args) => inner.close(...args),
    health: () => inner.health(),
    dispatch: (planId, step, options) =>
      step.action === 'get_treasury_balance'
        ? inner.dispatch(planId, step, options)
        : attack(planId, step, options),
  };
}

const EXPECTED: Record<Attack, object> = {
  policy_blocked_tool: {
    tool: 'update_vendor_destination',
    armoriq: 'block',
    enforcedBy: 'armoriq_policy',
    outcome: 'not_reached',
    errorClass: 'PolicyBlockedException',
  },
  altered_recipient: {
    tool: 'execute_payment',
    armoriq: 'allow',
    enforcedBy: 'fork_mcp',
    outcome: 'refused',
    errorClass: 'CAPABILITY_INVALID',
  },
  altered_amount: {
    tool: 'execute_payment',
    armoriq: 'allow',
    enforcedBy: 'fork_mcp',
    outcome: 'refused',
    errorClass: 'CAPABILITY_INVALID',
  },
  unplanned_tool: {
    tool: 'update_vendor_destination',
    armoriq: 'block',
    enforcedBy: 'armoriq_sdk',
    outcome: 'not_reached',
    errorClass: 'IntentMismatchException',
  },
};

describe('proof probes', () => {
  it.each(ATTACKS)('%s: a live allow, then the expected refusal', async (attack) => {
    const w = world();
    const result = await w.proofFor().run(attack);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toEqual({
      tool: 'get_treasury_balance',
      armoriq: 'allow',
      enforcedBy: null,
      outcome: 'executed',
      errorClass: null,
      matchedExpectation: true,
    });
    expect(result.steps[1]).toEqual({ ...EXPECTED[attack], matchedExpectation: true });
    expect(result.integrity).toBe('ok');
    expect(result.reference).toMatchObject({ vendor: 'Harbor Hosting', amountCents: 400_000 });
    expect(result.armorPlanId).toEqual(expect.any(String));
  });

  it('checks the capability both ways for altered payments, and not at all for the others', async () => {
    const w = world();
    const proof = w.proofFor();
    for (const attack of ['altered_recipient', 'altered_amount'] as const)
      expect((await proof.run(attack)).capabilityCheck).toEqual({
        originalArguments: 'valid',
        alteredArguments: 'invalid',
      });
    for (const attack of ['policy_blocked_tool', 'unplanned_tool'] as const)
      expect((await proof.run(attack)).capabilityCheck).toBeNull();
  });

  it('fails only on the alteration long after the reference was authorized', async () => {
    const w = world();
    const time = clock();
    const proof = w.proofFor({ now: time.now });
    await proof.run('altered_amount');
    // capabilities minted at authorization last 30 minutes. a probe gets its own.
    time.advance(2 * 3600);
    const later = await proof.run('altered_amount');
    expect(later.capabilityCheck?.originalArguments).toBe('valid');
    expect(later.steps[1]).toMatchObject({ errorClass: 'CAPABILITY_INVALID' });
    expect(sandboxRuns(w)).toHaveLength(1);
  });

  it('never yields a financial write, in either scenario', async () => {
    const w = world();
    const proof = w.proofFor();
    const before = {
      sandbox: postings(w, PROOF_SCENARIO),
      treasury: postings(w, SCENARIO),
      vendors: w.db.select().from(schema.vendors).all(),
    };
    for (const attack of ATTACKS) {
      const { ledger } = await proof.run(attack);
      expect(ledger).toEqual({
        sandbox: { cashBeforeCents: 5_000_000, cashAfterCents: 5_000_000, postingsAdded: 0 },
        treasury: { postingsAdded: 0 },
      });
    }
    expect(postings(w, PROOF_SCENARIO)).toBe(before.sandbox);
    expect(postings(w, SCENARIO)).toBe(before.treasury);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
    expect(w.db.select().from(schema.vendors).all()).toEqual(before.vendors);
    expect(w.db.select().from(schema.receipts).all()).toEqual([]);
    expect(w.db.select().from(schema.usedCapabilities).all()).toEqual([]);
  });

  it('leaves the treasury alone when the CFO has already paid from it', async () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const execution = await w.engine.commitBranch(b.id, CFO.email);
    await w.engine.settled(execution.id);
    const treasuryCash = cashCents(w.db, SCENARIO);
    expect(treasuryCash).toBeLessThan(5_000_000);

    const result = await w.proofFor().run('altered_recipient');
    expect(result.ledger.sandbox.cashBeforeCents).toBe(5_000_000);
    expect(result.reference.amountCents).toBe(400_000);
    expect(cashCents(w.db, SCENARIO)).toBe(treasuryCash);
  });

  it('never touches the reference branch, and no person appears in its audit trail', async () => {
    const w = world();
    const proof = w.proofFor();
    await proof.run('policy_blocked_tool');
    const [run] = sandboxRuns(w);
    const branch = () =>
      w.db.select().from(schema.branches).where(eq(schema.branches.runId, run!.id)).all();
    const steps = () => w.db.select().from(schema.branchActions).all();
    const frozen = { branch: branch(), steps: steps() };

    for (const attack of ATTACKS) await proof.run(attack);
    expect({ branch: branch(), steps: steps() }).toEqual(frozen);
    expect(sandboxRuns(w)).toHaveLength(1);
    expect(w.engine.timeline(run!.id).filter((event) => event.source === 'human')).toEqual([]);
    expect(w.db.select().from(schema.executions).all()).toEqual([]);
  });

  it('reports a result that differs from the expectation as unexpected, not as a pass', async () => {
    const w = world();
    // the platform policy is switched off
    const proof = w.proofFor({ gateway: w.gatewayFor({ block: [] }) });
    const result = await proof.run('policy_blocked_tool');
    expect(result.steps[1]).toEqual({
      tool: 'update_vendor_destination',
      armoriq: 'allow',
      enforcedBy: 'fork_mcp',
      outcome: 'refused',
      errorClass: 'NOT_PERMITTED',
      matchedExpectation: false,
    });
    expect(result.integrity).toBe('ok');
  });

  it('keeps capabilities, tokens and raw arguments out of the result', async () => {
    const w = world();
    const text = JSON.stringify(await w.proofFor().run('altered_recipient'));
    expect(text).not.toMatch(/approvedExecutionRef|idempotencyKey|recipient-external|token-/);
    expect(text).not.toMatch(/\.[0-9a-f]{64}/);
  });
});

describe('proof limits', () => {
  it('cools down, says how long, and remembers across a restart', async () => {
    const w = world();
    const time = clock();
    await w.proofFor({ now: time.now, cooldownSeconds: 20 }).run('unplanned_tool');
    time.advance(5);

    // a fresh instance over the same database, as after a restart
    const restarted = w.proofFor({ now: time.now, cooldownSeconds: 20 });
    await expect(restarted.run('unplanned_tool')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      details: { retryAfterSeconds: 15 },
    });
    expect(proofRows(w)).toHaveLength(1);

    time.advance(15);
    await expect(restarted.run('unplanned_tool')).resolves.toMatchObject({ integrity: 'ok' });
  });

  it('caps a UTC day and opens again at midnight UTC', async () => {
    const w = world();
    const time = clock(Date.parse('2026-10-14T23:59:00.000Z'));
    const proof = w.proofFor({ now: time.now, dailyLimit: 2 });
    await proof.run('unplanned_tool');
    await proof.run('unplanned_tool');
    const refused = await proof.run('unplanned_tool').catch((error) => error);
    expect(refused).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(refused.details.retryAfterSeconds).toBe(60);

    time.advance(60);
    await expect(proof.run('unplanned_tool')).resolves.toMatchObject({ integrity: 'ok' });
  });

  it('runs one probe at a time', async () => {
    const w = world();
    const proof = w.proofFor();
    const settled = await Promise.allSettled([
      proof.run('altered_amount'),
      proof.run('altered_amount'),
    ]);
    expect(settled.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(proofRows(w)).toHaveLength(1);
  });

  it('releases the lock when a dispatch throws, and nothing was posted', async () => {
    const w = world();
    let crash = true;
    const flaky = wrapped(w, (inner) => async (planId, step, options) => {
      if (crash) {
        crash = false;
        throw new Error('simulated crash');
      }
      return inner.dispatch(planId, step, options);
    });
    // the same instance both times, so a stuck lock would show as a 429
    const proof = w.proofFor({ gateway: flaky });
    await expect(proof.run('altered_amount')).rejects.toThrow('simulated crash');
    expect(postings(w, PROOF_SCENARIO)).toBe(3);
    await expect(proof.run('altered_amount')).resolves.toMatchObject({ integrity: 'ok' });
  });

  it('answers 503 and releases the lock when ArmorIQ fails at signing', async () => {
    const w = world();
    const proof = w.proofFor({ gateway: w.gatewayFor({ signFails: true }) });
    for (let i = 0; i < 2; i++)
      await expect(proof.run('altered_amount')).rejects.toMatchObject({
        code: 'ARMORIQ_UNAVAILABLE',
        status: 503,
      });
  });

  it('dispatches nothing and counts nothing when ArmorIQ is not configured', async () => {
    const w = world({}, false);
    await expect(w.proofFor().run('altered_amount')).rejects.toMatchObject({
      code: 'ARMORIQ_NOT_CONFIGURED',
      status: 503,
    });
    expect(proofRows(w)).toEqual([]);
  });

  it('carries on after a run that never finished', async () => {
    const w = world();
    const time = clock();
    // the engine died mid-probe: a row with no result
    w.db
      .insert(schema.proofRuns)
      .values({ attack: 'altered_amount', startedAt: time.now().toISOString() })
      .run();
    time.advance(20);
    await expect(
      w.proofFor({ now: time.now, cooldownSeconds: 20 }).run('altered_amount'),
    ).resolves.toMatchObject({ integrity: 'ok' });
  });
});

describe('proof integrity', () => {
  // a gateway that leaves a posting behind, which must never happen
  const leaky = (w: World) =>
    wrapped(w, (inner) => async (planId, step, options) => {
      postEntry(
        w.db,
        PROOF_SCENARIO,
        [
          { account: 'cash', amountCents: -100 },
          { account: 'equity', amountCents: 100 },
        ],
        new Date().toISOString(),
      );
      return inner.dispatch(planId, step, options);
    });

  it('switches proof mode off when a probe leaves a posting, and stays off across a restart', async () => {
    const w = world();
    const result = await w.proofFor({ gateway: leaky(w) }).run('altered_amount');
    expect(result.integrity).toBe('failed');
    expect(result.ledger.sandbox).toMatchObject({ postingsAdded: 2, cashAfterCents: 4_999_900 });

    const restarted = w.proofFor();
    await expect(restarted.run('altered_amount')).rejects.toMatchObject({
      code: 'PROOF_DISABLED',
      status: 503,
    });
    const [run] = sandboxRuns(w);
    expect(w.engine.timeline(run!.id).map((event) => event.type)).toContain(
      'security.proof_integrity_failure',
    );
  });

  it('comes back only after an explicit reset', async () => {
    const w = world();
    await w.proofFor({ gateway: leaky(w) }).run('altered_amount');
    const proof = w.proofFor();
    expect(proof.reset()).toBe(1);
    expect(proof.reset()).toBe(0);
    // the sandbox books changed, so the old reference is stale and a fresh one is authorized
    await expect(proof.run('altered_amount')).resolves.toMatchObject({ integrity: 'ok' });
    expect(sandboxRuns(w)).toHaveLength(2);
  });
});
