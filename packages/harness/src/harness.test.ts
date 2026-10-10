import { describe, expect, it } from 'vitest';
import { assertBranchTransition, assertStepTransition, InvalidTransitionError } from './lifecycle';
import { approvedPlanHash, type ApprovalSubject } from './plan';
import { runSteps, type StepResult } from './runner';

describe('branch lifecycle', () => {
  it('allows the normal path', () => {
    const path = ['PROPOSED', 'SIMULATED', 'APPROVED', 'COMMITTING', 'COMMITTED'] as const;
    for (let i = 1; i < path.length; i++) assertBranchTransition(path[i - 1]!, path[i]!);
  });

  it.each([
    ['PROPOSED', 'COMMITTING'],
    ['SIMULATED', 'COMMITTING'],
    ['PROPOSED', 'APPROVED'],
    ['INFEASIBLE', 'APPROVED'],
    ['STALE', 'APPROVED'],
    ['COMMITTED', 'COMMITTING'],
    ['APPROVED', 'SIMULATED'],
  ] as const)('refuses %s -> %s', (from, to) => {
    expect(() => assertBranchTransition(from, to)).toThrow(InvalidTransitionError);
  });
});

describe('step lifecycle', () => {
  it('never treats a hold as executed', () => {
    expect(() => assertStepTransition('HELD', 'EXECUTED')).toThrow(InvalidTransitionError);
    assertStepTransition('HELD', 'ALLOWED');
    assertStepTransition('ALLOWED', 'EXECUTED');
  });

  it('never executes a denied step', () => {
    expect(() => assertStepTransition('DENIED', 'EXECUTED')).toThrow(InvalidTransitionError);
    expect(() => assertStepTransition('DENIED', 'ALLOWED')).toThrow(InvalidTransitionError);
  });
});

describe('approvedPlanHash', () => {
  const subject: ApprovalSubject = {
    branchId: 'b',
    version: 1,
    baseSnapshotHash: 'h',
    currency: 'USD',
    actorId: 'cfo',
    steps: [
      {
        tool: 'execute_payment',
        kind: 'write',
        args: { vendorId: 'v-harbor', amountCents: 400_000 },
      },
      {
        tool: 'execute_payment',
        kind: 'write',
        args: { vendorId: 'v-beacon', amountCents: 600_000 },
      },
    ],
  };

  it('changes when a step param, the order, the base or the approver changes', () => {
    const [first, second] = subject.steps as [(typeof subject.steps)[0], (typeof subject.steps)[0]];
    const variants: ApprovalSubject[] = [
      { ...subject, steps: [{ ...first, args: { ...first.args, amountCents: 400_001 } }, second] },
      { ...subject, steps: [{ ...first, args: { ...first.args, vendorId: 'v-x' } }, second] },
      { ...subject, steps: [second, first] },
      { ...subject, baseSnapshotHash: 'other' },
      { ...subject, version: 2 },
      { ...subject, actorId: 'someone-else' },
    ];
    const hashes = new Set([subject, ...variants].map(approvedPlanHash));
    expect(hashes.size).toBe(variants.length + 1);
  });
});

describe('runSteps', () => {
  const steps = ['read', 'pay1', 'pay2', 'pay3'];
  function run(results: Record<string, StepResult['status']>, cancelAfter?: string) {
    const executed: string[] = [];
    const skipped: string[] = [];
    let cancelled = false;
    return runSteps<string>({
      steps,
      isWrite: (step) => step.startsWith('pay'),
      alreadyDone: () => undefined,
      cancelled: () => cancelled,
      execute: async (step) => {
        executed.push(step);
        if (step === cancelAfter) cancelled = true;
        return { status: results[step] ?? 'EXECUTED' } as StepResult;
      },
      skip: (step) => void skipped.push(step),
    }).then((summary) => ({ summary, executed, skipped }));
  }

  it('commits when every step executes', async () => {
    expect((await run({})).summary.final).toBe('COMMITTED');
  });

  it('stops at a denial and leaves the rest unexecuted', async () => {
    const { summary, executed, skipped } = await run({ pay2: 'DENIED' });
    expect(summary.final).toBe('PARTIALLY_COMMITTED');
    expect(executed).toEqual(['read', 'pay1', 'pay2']);
    expect(skipped).toEqual(['pay3']);
  });

  it('is blocked when nothing was paid', async () => {
    expect((await run({ pay1: 'DENIED' })).summary.final).toBe('BLOCKED');
  });

  it('carries on past a hold nobody approved, and says partial', async () => {
    const { summary, executed } = await run({ pay2: 'NOT_EXECUTED' });
    expect(summary.final).toBe('PARTIALLY_COMMITTED');
    expect(executed).toEqual(steps);
  });

  it('cancel stops future steps and keeps what was done', async () => {
    const { summary, executed, skipped } = await run({}, 'pay1');
    expect(summary).toMatchObject({ final: 'CANCELLED', executedWrites: 1 });
    expect(executed).toEqual(['read', 'pay1']);
    expect(skipped).toEqual(['pay2', 'pay3']);
  });
});
