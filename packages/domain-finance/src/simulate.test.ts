import { describe, expect, it } from 'vitest';
import { liquidityShortfall, referenceBranches } from './fixtures';
import { annotate } from './risk';
import { BranchProposalSchema, validateAllocations } from './schema';
import { feasibility, simulate } from './simulate';

const state = liquidityShortfall();
const [a, b, c] = referenceBranches(state) as [
  ReturnType<typeof referenceBranches>[0],
  ReturnType<typeof referenceBranches>[0],
  ReturnType<typeof referenceBranches>[0],
];
const run = (allocations: unknown) => simulate(state, validateAllocations(state, allocations));

describe('seed scenario', () => {
  it('has $50,000 cash and $68,000 due', () => {
    expect(state.cashCents).toBe(5_000_000);
    expect(state.invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0)).toBe(6_800_000);
  });
});

describe('branch A, pay everything', () => {
  const projection = run(a.allocations);

  it('overdraws by $18,000', () => {
    expect(projection.outflowCents).toBe(6_800_000);
    expect(projection.cashAfterCents).toBe(-1_800_000);
  });

  it('is infeasible, with reasons', () => {
    const result = feasibility(state, projection);
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(2);
  });
});

describe('branch B, preserve runway', () => {
  const projection = run(b.allocations);

  it('pays $40,000 and keeps $10,000', () => {
    expect(projection.outflowCents).toBe(4_000_000);
    expect(projection.cashAfterCents).toBe(1_000_000);
    expect(projection.deferredCents).toBe(2_800_000);
    expect(feasibility(state, projection).ok).toBe(true);
  });

  it('owes $505 in late fees, on Meridian and Alto only', () => {
    expect(projection.lateFeesCents).toBe(50_500);
    const fees = Object.fromEntries(
      projection.lines
        .filter((line) => line.lateFeeCents > 0)
        .map((line) => [line.invoiceId, line.lateFeeCents]),
    );
    expect(fees).toEqual({ 'INV-03': 16_500, 'INV-05': 34_000 });
  });

  it('needs one approval, for payroll', () => {
    const risk = annotate(state, projection);
    expect(risk.approvalsNeeded).toBe(1);
    expect(risk.criticalDeferred).toEqual([]);
    expect(risk.vendorsWithBalance).toEqual(['v-meridian', 'v-alto']);
  });
});

describe('branch C, share the shortfall', () => {
  const projection = run(c.allocations);

  it('spends exactly $42,000 and lands exactly on the reserve', () => {
    expect(projection.outflowCents).toBe(4_200_000);
    expect(projection.cashAfterCents).toBe(800_000);
    expect(projection.reserveBreached).toBe(false);
    expect(feasibility(state, projection).ok).toBe(true);
  });

  it('splits by largest remainder with no fractional cents', () => {
    expect(c.allocations.map((item) => item.payCents)).toEqual([
      247_059, 494_118, 679_412, 370_588, 1_050_000, 741_176, 308_824, 308_823,
    ]);
  });

  it('leaves every invoice partly unpaid, with fees on the fee-bearing ones', () => {
    expect(projection.lines.every((line) => line.remainingCents > 0)).toBe(true);
    const withFees = projection.lines
      .filter((line) => line.lateFeeCents > 0)
      .map((line) => line.invoiceId);
    expect(withFees).toEqual(['INV-01', 'INV-02', 'INV-03', 'INV-04', 'INV-05']);
    expect(annotate(state, projection).criticalDeferred).toEqual(['INV-01', 'INV-04', 'INV-06']);
  });
});

describe('simulate', () => {
  it('does not touch the state it is given', () => {
    const before = JSON.stringify(state);
    for (const branch of [a, b, c]) run(branch.allocations);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('gives a 14-day cash path that starts at opening cash', () => {
    const { cashPath } = run(b.allocations);
    expect(cashPath).toHaveLength(14);
    expect(cashPath[0]).toEqual({ date: '2026-10-12', cashCents: 5_000_000 });
    expect(cashPath[13]).toEqual({ date: '2026-10-25', cashCents: 1_000_000 });
  });

  it('treats a missing invoice as deferred', () => {
    const projection = run([{ invoiceId: 'INV-01', payCents: 400_000 }]);
    expect(projection.lines).toHaveLength(8);
    expect(projection.outflowCents).toBe(400_000);
  });
});

describe('validation', () => {
  const bad: [string, unknown][] = [
    ['an unknown invoice', [{ invoiceId: 'INV-99', payCents: 100 }]],
    ['overpayment', [{ invoiceId: 'INV-01', payCents: 400_001 }]],
    ['a negative amount', [{ invoiceId: 'INV-01', payCents: -1 }]],
    ['a fractional amount', [{ invoiceId: 'INV-01', payCents: 100.5 }]],
    [
      'a duplicate invoice',
      [
        { invoiceId: 'INV-01', payCents: 1 },
        { invoiceId: 'INV-01', payCents: 1 },
      ],
    ],
    ['extra fields', [{ invoiceId: 'INV-01', payCents: 1, recipientId: 'recipient-external-999' }]],
  ];
  it.each(bad)('rejects %s', (_name, input) => {
    expect(() => validateAllocations(state, input)).toThrow();
  });

  it('rejects paying a vendor that is not approved', () => {
    const risky = {
      ...state,
      vendors: state.vendors.map((v) => (v.id === 'v-harbor' ? { ...v, approved: false } : v)),
    };
    expect(() => validateAllocations(risky, [{ invoiceId: 'INV-01', payCents: 1 }])).toThrow(
      /not approved/,
    );
  });

  it('rejects more than three branches', () => {
    const branch = {
      title: 't',
      rationale: 'r',
      allocations: [{ invoiceId: 'INV-01', payCents: 1 }],
    };
    expect(BranchProposalSchema.safeParse({ branches: [branch, branch, branch] }).success).toBe(
      true,
    );
    expect(
      BranchProposalSchema.safeParse({ branches: [branch, branch, branch, branch] }).success,
    ).toBe(false);
  });
});
