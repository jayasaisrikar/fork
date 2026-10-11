import type { Cents } from '@fork/shared';
import { z } from 'zod';

export interface Holding {
  symbol: string;
  name: string;
  units: number;
  priceCents: Cents;
}

export interface PortfolioState {
  portfolioId: string;
  currency: 'USD';
  cashCents: Cents;
  // the least cash the mandate lets the portfolio hold
  minCashCents: Cents;
  // the most one position may be, in basis points of the whole portfolio
  maxWeightBps: number;
  holdings: Holding[];
}

export const TradeSchema = z.strictObject({
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  units: z.number().int().positive(),
});
export type Trade = z.infer<typeof TradeSchema>;

export class TradeError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join('; '));
    this.name = 'TradeError';
  }
}

// known holdings only, one trade per holding
export function validateTrades(state: PortfolioState, input: unknown): Trade[] {
  const parsed = z.array(TradeSchema).safeParse(input);
  if (!parsed.success) {
    throw new TradeError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }

  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const { symbol } of parsed.data) {
    if (!state.holdings.some((holding) => holding.symbol === symbol)) {
      reasons.push(`${symbol} is not a holding in this portfolio`);
    } else if (seen.has(symbol)) reasons.push(`${symbol} is traded twice`);
    seen.add(symbol);
  }
  if (reasons.length) throw new TradeError(reasons);
  return parsed.data;
}
