import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { hashCanonical } from './hash';

const plan = {
  branchId: 'b1',
  version: 1,
  baseSnapshotHash: 'abc',
  currency: 'USD',
  steps: [
    { vendorId: 'v-harbor', amountCents: 400_000 },
    { vendorId: 'v-beacon', amountCents: 600_000 },
  ],
};

describe('canonicalJson', () => {
  it('sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
  });

  it('rejects fractional numbers', () => {
    expect(() => canonicalJson({ amount: 10.5 })).toThrow();
  });
});

describe('hashCanonical', () => {
  it('ignores key order', () => {
    const reordered = {
      steps: plan.steps.map((s) => ({ amountCents: s.amountCents, vendorId: s.vendorId })),
      currency: 'USD',
      version: 1,
      branchId: 'b1',
      baseSnapshotHash: 'abc',
    };
    expect(hashCanonical(reordered)).toBe(hashCanonical(plan));
  });

  it('changes with vendor, amount, currency, step order or base version', () => {
    const [first, second] = plan.steps as [(typeof plan.steps)[0], (typeof plan.steps)[0]];
    const variants = [
      { ...plan, steps: [{ ...first, vendorId: 'v-other' }, second] },
      { ...plan, steps: [{ ...first, amountCents: 400_001 }, second] },
      { ...plan, currency: 'EUR' },
      { ...plan, steps: [second, first] },
      { ...plan, baseSnapshotHash: 'abd' },
      { ...plan, version: 2 },
    ];
    const hashes = new Set([plan, ...variants].map(hashCanonical));
    expect(hashes.size).toBe(variants.length + 1);
  });
});
