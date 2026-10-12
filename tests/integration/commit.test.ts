import { cashCents, schema } from '@fork/db';
import { PROOF_SCENARIO, proofSandbox, referenceBranches } from '@fork/domain-finance';
import { InvalidTransitionError } from '@fork/harness';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PROOF_ACTOR, REJECTED_BY_FORK } from '../../apps/engine/src/service';
import { CFO, SCENARIO, world } from '../support/world';

type World = ReturnType<typeof world>;

const auditTypes = (w: World, runId: number) => w.engine.timeline(runId).map((event) => event.type);
const receiptCount = (w: World) =>
  w.db.get<{ n: number }>(sql`select count(*) as n from receipts`).n;
const stepsOf = (w: World, runId: number) => w.engine.getRun(runId).steps;
const statusOf = (w: World, branchId: string) =>
  w.engine.getRun(1).branches.find((branch) => branch.id === branchId)?.status;

async function commit(w: World, branchId: string) {
  const execution = await w.engine.commitBranch(branchId, CFO.email);
  await w.engine.settled(execution.id);
  return execution;
}

describe('simulation and authorization', () => {
  it('marks pay-everything infeasible and FORK refuses to authorize it', () => {
    const w = world();
    const { run, a } = w.simulated();
    expect(a.status).toBe('INFEASIBLE');
    expect(a.feasibility?.reasons).toHaveLength(2);
    expect(() => w.engine.authorizeBranch(a.id, CFO.email)).toThrow(InvalidTransitionError);

    const rejected = w.engine
      .timeline(run.id)
      .find((event) => event.type === 'branch.rejected_by_fork');
    expect(rejected).toMatchObject({ source: 'fork', payload: { verdict: REJECTED_BY_FORK } });
    expect(w.gateway.signCount()).toBe(0);
  });

  it('will not commit a branch that was only proposed or simulated', async () => {
    const w = world();
    const { b } = w.simulated();
    await expect(w.engine.commitBranch(b.id, CFO.email)).rejects.toThrow(InvalidTransitionError);
    expect(w.gateway.signCount()).toBe(0);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
  });

  it('logs a refused transition as a security event', async () => {
    const w = world();
    const { b } = w.simulated();
    await w.engine.commitBranch(b.id, CFO.email).catch(() => undefined);
    const events = w.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.type, 'security.invalid_transition'))
      .all();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ from: 'SIMULATED', to: 'COMMITTING' });
  });

  it('freezes the exact steps and gives each payment its own capability', () => {
    const w = world();
    const { b } = w.simulated();
    const { steps, approvedPlanHash } = w.engine.authorizeBranch(b.id, CFO.email);

    expect(steps.map((step) => step.tool)).toEqual([
      'get_treasury_balance',
      'execute_payment',
      'get_sandbox_messages',
      'execute_payment',
      'execute_payment',
      'execute_large_payment',
      'execute_payment',
      'execute_payment',
      'get_treasury_balance',
    ]);
    expect(approvedPlanHash).toMatch(/^[0-9a-f]{64}$/);

    const stored = w.db.select().from(schema.branchActions).all();
    const capabilities = stored.filter((row) => row.kind === 'write').map((row) => row.capability);
    expect(new Set(capabilities).size).toBe(6);
    expect(
      stored.filter((row) => row.kind === 'read').every((row) => row.capability === null),
    ).toBe(true);
    // the API view never carries a capability
    expect(JSON.stringify(w.engine.getRun(1))).not.toContain(capabilities[0]);
  });

  it('cannot be authorized twice', () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    expect(() => w.engine.authorizeBranch(b.id, CFO.email)).toThrow(InvalidTransitionError);
  });
});

describe('commit', () => {
  it('commits branch B: six payments, one held and approved, cash lands on $10,000', async () => {
    const w = world();
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const execution = await commit(w, b.id);

    expect(statusOf(w, b.id)).toBe('COMMITTED');
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
    expect(receiptCount(w)).toBe(6);

    const steps = stepsOf(w, run.id);
    expect(steps.every((step) => step.status === 'EXECUTED' && step.source === 'armoriq')).toBe(
      true,
    );
    expect(steps.filter((step) => step.kind === 'write').every((step) => step.receiptId)).toBe(
      true,
    );
    expect(steps.find((step) => step.tool === 'execute_large_payment')).toMatchObject({
      delegationId: 'dlg-1',
    });

    expect(execution).toMatchObject({
      armorPlanId: 'plan-1',
      tokenId: 'token-1',
      approvedPlanHash: b.approvedPlanHash ?? expect.any(String),
    });
    expect(w.gateway.closed).toEqual([{ planId: 'plan-1', status: 'completed' }]);
    expect(auditTypes(w, run.id)).toContain('ledger.reconciled');
  });

  it('leaves a rejected hold unpaid and says the commit was partial', async () => {
    const w = world({ approveHolds: false });
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await commit(w, b.id);

    expect(statusOf(w, b.id)).toBe('PARTIALLY_COMMITTED');
    expect(cashCents(w.db, SCENARIO)).toBe(2_200_000);
    const held = stepsOf(w, run.id).find((step) => step.tool === 'execute_large_payment');
    expect(held).toMatchObject({
      status: 'NOT_EXECUTED',
      verdict: 'hold',
      receiptId: null,
      errorClass: 'DelegationException',
    });
    expect(w.gateway.closed[0]?.status).toBe('failed');
  });

  it('stops at an ArmorIQ block and runs nothing after it', async () => {
    const w = world({ block: ['get_sandbox_messages'] });
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await commit(w, b.id);

    expect(statusOf(w, b.id)).toBe('PARTIALLY_COMMITTED');
    expect(cashCents(w.db, SCENARIO)).toBe(4_600_000);
    const steps = stepsOf(w, run.id);
    expect(steps[2]).toMatchObject({
      verdict: 'block',
      source: 'armoriq',
      errorClass: 'PolicyBlockedException',
      status: 'NOT_EXECUTED',
    });
    expect(
      steps.slice(3).every((step) => step.status === 'NOT_EXECUTED' && step.verdict === null),
    ).toBe(true);
  });

  it('is BLOCKED, with the ledger untouched, when the first call is refused', async () => {
    const w = world({ block: ['get_treasury_balance'] });
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await commit(w, b.id);
    expect(statusOf(w, b.id)).toBe('BLOCKED');
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
  });

  it('rejects a changed step before anything is signed or dispatched', async () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    // someone edits a stored step after approval
    const first = w.db
      .select()
      .from(schema.branchActions)
      .where(eq(schema.branchActions.kind, 'write'))
      .get()!;
    w.db
      .update(schema.branchActions)
      .set({ args: { ...first.args, recipientId: 'recipient-external-999' } })
      .where(eq(schema.branchActions.id, first.id))
      .run();

    await expect(w.engine.commitBranch(b.id, CFO.email)).rejects.toMatchObject({
      code: 'APPROVAL_INVALID',
    });
    expect(w.gateway.signCount()).toBe(0);
    expect(w.gateway.dispatched).toHaveLength(0);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
  });

  it('pays each step at most once when two commits race', async () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const results = await Promise.allSettled([
      w.engine.commitBranch(b.id, CFO.email),
      w.engine.commitBranch(b.id, CFO.email),
    ]);
    for (const result of results)
      if (result.status === 'fulfilled') await w.engine.settled(result.value.id);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(receiptCount(w)).toBe(6);
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
    expect(w.gateway.closed).toContainEqual({ planId: expect.any(String), status: 'failed' });
  });

  it('will not let a second branch spend cash the first already used', async () => {
    const w = world();
    const first = w.simulated();
    const second = w.simulated();
    w.engine.authorizeBranch(first.b.id, CFO.email);
    w.engine.authorizeBranch(second.c.id, CFO.email);
    await commit(w, first.b.id);

    await expect(w.engine.commitBranch(second.c.id, CFO.email)).rejects.toMatchObject({
      code: 'STALE',
    });
    expect(
      w.engine.getRun(second.run.id).branches.find((branch) => branch.id === second.c.id)?.status,
    ).toBe('STALE');
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);

    // and nothing else from that old snapshot can be authorized either
    expect(() => w.engine.authorizeBranch(second.b.id, CFO.email)).toThrow(/books changed/);
  });

  it('cancel stops future steps and keeps the receipts already issued', async () => {
    const w = world();
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const execution = await w.engine.commitBranch(b.id, CFO.email);
    w.engine.cancelBranch(b.id, CFO.email);
    await w.engine.settled(execution.id);

    expect(statusOf(w, b.id)).toBe('CANCELLED');
    const paid = receiptCount(w);
    expect(paid).toBeLessThan(6);
    expect(cashCents(w.db, SCENARIO)).toBe(
      5_000_000 +
        w.db.get<{ n: number }>(
          sql`select coalesce(sum(amountCents), 0) as n from ledger_postings where account = 'cash' and receiptId is not null`,
        ).n,
    );
    expect(
      stepsOf(w, run.id).filter((step) => step.status === 'NOT_EXECUTED').length,
    ).toBeGreaterThan(0);
  });
});

describe('restart mid-run', () => {
  it('reconciles without paying anything twice', async () => {
    const w = world();
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);

    // dies right after the second MCP call, which is the first payment
    const crashing = w.engineFor(w.gatewayFor({ crashAfterCalls: 2 }));
    const execution = await crashing.commitBranch(b.id, CFO.email);
    await crashing.settled(execution.id);
    expect(statusOf(w, b.id)).toBe('COMMITTING');
    expect(cashCents(w.db, SCENARIO)).toBe(4_600_000);
    expect(stepsOf(w, run.id)[1]?.status).toBe('AUTHORIZING');

    const restartedGateway = w.gatewayFor();
    const restarted = w.engineFor(restartedGateway);
    await restarted.resumeInFlight();
    await restarted.settled(execution.id);

    expect(statusOf(w, b.id)).toBe('COMMITTED');
    expect(receiptCount(w)).toBe(6);
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
    expect(restartedGateway.signCount()).toBe(1);
  });

  it('will not re-sign if the approved steps changed while it was down', async () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const crashing = w.engineFor(w.gatewayFor({ crashAfterCalls: 2 }));
    await crashing.settled((await crashing.commitBranch(b.id, CFO.email)).id);

    const last = w.db
      .select()
      .from(schema.branchActions)
      .where(eq(schema.branchActions.tool, 'execute_large_payment'))
      .get()!;
    w.db
      .update(schema.branchActions)
      .set({ args: { ...last.args, amountCents: 1_300_000 } })
      .where(eq(schema.branchActions.id, last.id))
      .run();

    const restartedGateway = w.gatewayFor();
    await w.engineFor(restartedGateway).resumeInFlight();
    expect(restartedGateway.signCount()).toBe(0);
    expect(statusOf(w, b.id)).toBe('BLOCKED');
    expect(cashCents(w.db, SCENARIO)).toBe(4_600_000);
  });
});

describe('fail closed', () => {
  it('refuses to commit when ArmorIQ does not answer, and pays nothing', async () => {
    const w = world({ signFails: true });
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);

    await expect(w.engine.commitBranch(b.id, CFO.email)).rejects.toMatchObject({
      code: 'ARMORIQ_UNAVAILABLE',
      status: 503,
    });
    expect(statusOf(w, b.id)).toBe('APPROVED');
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
    expect(auditTypes(w, run.id)).toContain('armoriq.unavailable');
  });

  it('refuses to commit when ArmorIQ is not configured', async () => {
    const w = world({}, false);
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await expect(w.engine.commitBranch(b.id, CFO.email)).rejects.toMatchObject({
      code: 'ARMORIQ_NOT_CONFIGURED',
    });
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
  });
});

describe('tamper test', () => {
  it('gets a real block for a tool outside the plan and an MCP refusal for an altered recipient', async () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const before = w.db.select().from(schema.vendors).all();
    const { steps } = await w.engine.tamperTest(b.id, CFO.email);

    expect(steps[0]).toMatchObject({
      origin: 'tamper_test',
      tool: 'update_vendor_destination',
      verdict: 'block',
      source: 'armoriq',
      errorClass: 'IntentMismatchException',
      status: 'NOT_EXECUTED',
    });
    // not bound by ArmorIQ, so it is allowed through, and then our MCP refuses it
    expect(steps[1]).toMatchObject({
      tool: 'execute_payment',
      verdict: 'allow',
      source: 'mcp',
      errorClass: 'CAPABILITY_INVALID',
      status: 'NOT_EXECUTED',
    });

    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
    expect(w.db.select().from(schema.vendors).all()).toEqual(before);
    expect(statusOf(w, b.id)).toBe('APPROVED');
  });

  it('does not spoil the real commit afterwards', async () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await w.engine.tamperTest(b.id, CFO.email);
    await commit(w, b.id);
    expect(statusOf(w, b.id)).toBe('COMMITTED');
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
  });
});

// run -> fixture branch B on the proof sandbox -> authorized by the system
function sandboxB(w: World) {
  const run = w.engine.createRun(PROOF_ACTOR, PROOF_SCENARIO, 'system');
  const fixtures = referenceBranches(proofSandbox()).map(({ title, rationale, allocations }) => ({
    title,
    rationale,
    allocations,
  }));
  const b = w.engine.addBranches(run.id, { branches: fixtures }, 'fixture')[1]!;
  w.engine.simulateBranch(b.id);
  w.engine.authorizeBranch(b.id, PROOF_ACTOR, 'system');
  return { run, b };
}

describe('system-authorized branches', () => {
  it('leave no human event in the audit trail', () => {
    const w = world();
    const { run } = sandboxB(w);
    const events = w.engine.timeline(run.id);
    expect(events.filter((event) => event.source === 'human')).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['run.created_by_system', 'branch.authorized_by_system']),
    );
    expect(events.map((event) => event.type)).not.toContain('run.created');
    expect(events.map((event) => event.type)).not.toContain('branch.authorized');
  });

  it('record the origin on the approval', () => {
    const w = world();
    const { b } = sandboxB(w);
    const approval = w.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.branchId, b.id))
      .get();
    expect(approval).toMatchObject({ origin: 'system', actor: PROOF_ACTOR });
  });

  it('can never be committed, by anyone', async () => {
    const w = world();
    const { b } = sandboxB(w);
    await expect(w.engine.commitBranch(b.id, CFO.email)).rejects.toMatchObject({
      code: 'SYSTEM_AUTHORIZED',
      status: 409,
    });
    expect(cashCents(w.db, PROOF_SCENARIO)).toBe(5_000_000);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
    expect(receiptCount(w)).toBe(0);
    expect(w.gateway.signCount()).toBe(0);
  });

  it('stay out of the CFO run list, and human runs still read as human', () => {
    const w = world();
    sandboxB(w);
    const { run } = w.simulated();
    expect(w.engine.listRuns().map((item) => item.id)).toEqual([run.id]);
    expect(w.engine.timeline(run.id)[0]).toMatchObject({ source: 'human', type: 'run.created' });
  });
});
