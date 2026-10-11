import { dryRun } from '@fork/harness';
import { describe, expect, it } from 'vitest';
import { portfolioAdapter } from './adapter';
import { driftedReserve, referenceRebalances } from './fixtures';
import { TradeError, validateTrades } from './schema';

const state = driftedReserve();
const frozen = JSON.stringify(state);
const [a, b, c] = dryRun(portfolioAdapter, state, referenceRebalances());

describe('seed portfolio', () => {
  it('is worth $100,000 with equity over the limit', () => {
    expect(b!.projection.totalCents).toBe(10_000_000);
    expect(b!.projection.positions[0]!.weightBeforeBps).toBe(4600);
  });
});

describe('the three rebalances through the harness', () => {
  it('rejects A: it overspends and breaks the limit', () => {
    expect(a!.status).toBe('INFEASIBLE');
    expect(a!.projection.cashAfterCents).toBe(-500_000);
    expect(a!.feasibility.reasons).toHaveLength(2);
  });

  it('simulates B to exactly the limit', () => {
    expect(b!.status).toBe('SIMULATED');
    expect(b!.projection.largestWeightBps).toBe(3500);
    expect(b!.projection.cashAfterCents).toBe(2_000_000);
    expect(b!.diff.map((line) => line.symbol)).toEqual(['NRTH']);
  });

  it('simulates C with both legs', () => {
    expect(c!.status).toBe('SIMULATED');
    expect(c!.projection.cashAfterCents).toBe(1_400_000);
    expect(c!.projection.turnoverCents).toBe(2_500_000);
    expect(c!.projection.totalCents).toBe(10_000_000);
  });

  it('never changes the snapshot', () => {
    expect(JSON.stringify(state)).toBe(frozen);
  });
});

describe('read-only', () => {
  it('has no tool steps to sign', () => {
    expect(portfolioAdapter.toToolSteps(state, b!.actions, 'x')).toEqual([]);
  });

  it('fails the postcondition if anything moved', () => {
    expect(portfolioAdapter.verifyPostcondition(state, state, []).ok).toBe(true);
    const moved = { ...state, cashCents: state.cashCents - 1 };
    expect(portfolioAdapter.verifyPostcondition(state, moved, []).ok).toBe(false);
  });
});

describe('validation', () => {
  it.each([
    [[{ symbol: 'NOPE', side: 'buy', units: 1 }]],
    [[{ symbol: 'NRTH', side: 'sell', units: 0 }]],
    [[{ symbol: 'NRTH', side: 'sell', units: 1.5 }]],
    [[{ symbol: 'NRTH', side: 'short', units: 1 }]],
    [
      [
        { symbol: 'NRTH', side: 'sell', units: 1 },
        { symbol: 'NRTH', side: 'buy', units: 1 },
      ],
    ],
    [[{ symbol: 'NRTH', side: 'sell', units: 1, recipientId: 'x' }]],
  ])('refuses %j', (input) => {
    expect(() => validateTrades(state, input)).toThrow(TradeError);
  });
});
