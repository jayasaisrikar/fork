import { describe, expect, it } from 'vitest';
import { allocateProRata, formatUsd } from './money';

describe('allocateProRata', () => {
  it('hands leftover cents to the largest remainders', () => {
    const result = allocateProRata(100, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 },
    ]);
    expect([...result.values()]).toEqual([34, 33, 33]);
  });

  it('breaks ties by id, whatever the input order', () => {
    const result = allocateProRata(1, [
      { id: 'z', weight: 5 },
      { id: 'm', weight: 5 },
    ]);
    expect(result.get('m')).toBe(1);
    expect(result.get('z')).toBe(0);
  });

  it('always sums to the total', () => {
    const shares = [7, 13, 29, 31, 1].map((weight, i) => ({ id: `s${i}`, weight }));
    for (const total of [0, 1, 99, 4_200_000]) {
      const sum = [...allocateProRata(total, shares).values()].reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });

  it('refuses fractional totals', () => {
    expect(() => allocateProRata(10.5, [{ id: 'a', weight: 1 }])).toThrow();
  });
});

describe('formatUsd', () => {
  it('formats cents', () => {
    expect(formatUsd(5_000_000)).toBe('$50,000.00');
    expect(formatUsd(50_500)).toBe('$505.00');
    expect(formatUsd(-1_800_000)).toBe('−$18,000.00');
    expect(formatUsd(5)).toBe('$0.05');
  });
});
