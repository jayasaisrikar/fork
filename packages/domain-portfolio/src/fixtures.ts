import type { PortfolioState, Trade } from './schema';

// Kettle & Pine's reserve portfolio. the funds are fictional.
export function driftedReserve(): PortfolioState {
  return {
    portfolioId: 'reserve-drift',
    currency: 'USD',
    cashCents: 900_000,
    minCashCents: 500_000,
    maxWeightBps: 3500,
    holdings: [
      { symbol: 'NRTH', name: 'Northfield Equity Fund', units: 460, priceCents: 10_000 },
      { symbol: 'BRKW', name: 'Brookwater Bond Fund', units: 500, priceCents: 5_000 },
      { symbol: 'SLTE', name: 'Slate Treasury Bills', units: 200, priceCents: 10_000 },
    ],
  };
}

export interface ReferenceRebalance {
  label: 'A' | 'B' | 'C';
  title: string;
  rationale: string;
  actions: Trade[];
}

// fixture only. no model proposes these.
export function referenceRebalances(): ReferenceRebalance[] {
  return [
    {
      label: 'A',
      title: 'Move it all to T-bills',
      rationale:
        'Sells the whole equity position and buys treasury bills. It buys more than the sale raises.',
      actions: [
        { symbol: 'NRTH', side: 'sell', units: 460 },
        { symbol: 'SLTE', side: 'buy', units: 600 },
      ],
    },
    {
      label: 'B',
      title: 'Trim to the limit',
      rationale: 'Sells just enough equity to get back to the 35% limit and keeps the cash.',
      actions: [{ symbol: 'NRTH', side: 'sell', units: 110 }],
    },
    {
      label: 'C',
      title: 'Rotate into bonds',
      rationale: 'Sells more equity and puts two thirds of it into the bond fund.',
      actions: [
        { symbol: 'NRTH', side: 'sell', units: 150 },
        { symbol: 'BRKW', side: 'buy', units: 200 },
      ],
    },
  ];
}
