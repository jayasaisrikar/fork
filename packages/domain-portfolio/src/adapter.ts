import type { ForkDomainAdapter } from '@fork/harness';
import { validateTrades, type PortfolioState, type Trade } from './schema';
import { feasibility, simulate, type PortfolioProjection, type PositionLine } from './simulate';

// the second domain. it can fork and compare, and that is all: it has no tools, so there is
// nothing to sign and nothing to run.
export const portfolioAdapter: ForkDomainAdapter<
  PortfolioState,
  Trade,
  PortfolioProjection,
  PositionLine[],
  never
> = {
  validateActions: validateTrades,
  simulate,
  diff: (_base, projected) =>
    projected.positions.filter((line) => line.unitsAfter !== line.unitsBefore),
  feasibility,
  toToolSteps: () => [],
  // a dry run must leave the portfolio exactly as it found it
  verifyPostcondition(before, after, receipts) {
    const problems: string[] = [];
    if (receipts.length) problems.push('A dry-run domain produced a receipt');
    if (JSON.stringify(before) !== JSON.stringify(after)) problems.push('The portfolio changed');
    return { ok: problems.length === 0, problems };
  },
};
