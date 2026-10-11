import { formatUsd, type Cents } from '@fork/shared';
import type { PortfolioState, Trade } from './schema';

export interface PositionLine {
  symbol: string;
  name: string;
  unitsBefore: number;
  unitsAfter: number;
  valueBeforeCents: Cents;
  valueAfterCents: Cents;
  weightBeforeBps: number;
  weightAfterBps: number;
}

export interface PortfolioProjection {
  // trades happen at the snapshot's prices, so the total does not move
  totalCents: Cents;
  cashAfterCents: Cents;
  turnoverCents: Cents;
  largestWeightBps: number;
  positions: PositionLine[];
}

const bps = (part: Cents, whole: Cents) => (whole > 0 ? Math.round((part * 10_000) / whole) : 0);
export const percent = (weightBps: number) => `${(weightBps / 100).toFixed(1)}%`;

// pure. expects trades that already went through validateTrades.
export function simulate(state: PortfolioState, trades: Trade[]): PortfolioProjection {
  const signed = new Map(
    trades.map((trade) => [trade.symbol, trade.side === 'buy' ? trade.units : -trade.units]),
  );
  const invested = state.holdings.reduce((sum, h) => sum + h.units * h.priceCents, 0);
  const totalCents = invested + state.cashCents;

  let cashAfterCents = state.cashCents;
  let turnoverCents = 0;
  const positions = state.holdings.map((holding) => {
    const change = signed.get(holding.symbol) ?? 0;
    cashAfterCents -= change * holding.priceCents;
    turnoverCents += Math.abs(change) * holding.priceCents;
    const valueBeforeCents = holding.units * holding.priceCents;
    const valueAfterCents = (holding.units + change) * holding.priceCents;
    return {
      symbol: holding.symbol,
      name: holding.name,
      unitsBefore: holding.units,
      unitsAfter: holding.units + change,
      valueBeforeCents,
      valueAfterCents,
      weightBeforeBps: bps(valueBeforeCents, totalCents),
      weightAfterBps: bps(valueAfterCents, totalCents),
    };
  });

  return {
    totalCents,
    cashAfterCents,
    turnoverCents,
    largestWeightBps: Math.max(0, ...positions.map((line) => line.weightAfterBps)),
    positions,
  };
}

export function feasibility(state: PortfolioState, projection: PortfolioProjection) {
  const reasons: string[] = [];
  for (const line of projection.positions) {
    if (line.unitsAfter < 0) {
      reasons.push(
        `Sells ${-line.unitsAfter} more units of ${line.symbol} than the portfolio holds`,
      );
    }
    if (line.weightAfterBps > state.maxWeightBps) {
      reasons.push(
        `Leaves ${line.symbol} at ${percent(line.weightAfterBps)}, above the ${percent(state.maxWeightBps)} limit`,
      );
    }
  }
  if (projection.cashAfterCents < 0) {
    reasons.push(`Buys ${formatUsd(-projection.cashAfterCents)} more than the cash available`);
  } else if (projection.cashAfterCents < state.minCashCents) {
    const short = state.minCashCents - projection.cashAfterCents;
    reasons.push(`Leaves cash ${formatUsd(short)} below the minimum`);
  }
  return { ok: reasons.length === 0, reasons };
}
