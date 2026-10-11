import { financeAdapter, liquidityShortfall, referenceBranches } from '@fork/domain-finance';
import {
  driftedReserve,
  percent,
  portfolioAdapter,
  referenceRebalances,
} from '@fork/domain-portfolio';
import {
  dryRun,
  type DryBranch,
  type ForkDomainAdapter,
  type Proposal,
} from '@fork/harness/dry-run';
import { usd, usdShort } from './format';

export interface LabStep {
  tool: string;
  kind: 'read' | 'write';
}

export interface LabBranch {
  label: string;
  title: string;
  rationale: string;
  status: 'SIMULATED' | 'INFEASIBLE';
  reasons: string[];
  figure: string;
  figureName: string;
  stats: string[];
  // name, before, after, change
  rows: [string, string, string, string][];
  steps: LabStep[];
}

export interface LabDomain {
  id: 'treasury' | 'portfolio';
  name: string;
  mode: 'Full' | 'Dry run';
  adapter: string;
  source: string;
  base: string;
  columns: [string, string, string, string];
  branches: LabBranch[];
}

type Shown = Pick<LabBranch, 'figure' | 'figureName' | 'stats' | 'rows' | 'reasons'>;

// the one path both domains take. only `show` knows what the numbers mean.
function fork<Base, Action, Projection, Diff, Receipt>(
  adapter: ForkDomainAdapter<Base, Action, Projection, Diff, Receipt>,
  base: Base,
  proposals: Proposal[],
  show: (branch: DryBranch<Action, Projection, Diff>) => Shown,
): LabBranch[] {
  return dryRun(adapter, base, proposals).map((branch) => ({
    label: branch.label,
    title: branch.title,
    rationale: branch.rationale,
    status: branch.status,
    steps: adapter
      .toToolSteps(base, branch.actions, 'lab')
      .map(({ tool, kind }) => ({ tool, kind })),
    ...show(branch),
  }));
}

function treasury(): LabDomain {
  const state = liquidityShortfall();
  const due = state.invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0);
  const vendor = (id: string) => state.vendors.find((item) => item.id === id)?.name ?? id;
  const proposals = referenceBranches(state).map(({ allocations, ...rest }) => ({
    ...rest,
    actions: allocations,
  }));

  return {
    id: 'treasury',
    name: 'Treasury',
    mode: 'Full',
    adapter: 'financeAdapter',
    source: 'packages/domain-finance/src/adapter.ts',
    base: `${usdShort(state.cashCents)} cash, ${usdShort(due)} due, ${usdShort(state.reserveCents)} reserve`,
    columns: ['Invoice', 'Owed', 'Left unpaid', 'Paid'],
    branches: fork(financeAdapter, state, proposals, ({ projection, diff }) => ({
      figure: usdShort(projection.cashAfterCents),
      figureName: 'cash left',
      stats: [
        `${usdShort(projection.outflowCents)} paid`,
        `${usdShort(projection.deferredCents)} deferred`,
        `${usdShort(projection.lateFeesCents)} fees`,
      ],
      reasons: [
        ...(projection.cashAfterCents < 0
          ? [`Overdraws the account by ${usdShort(-projection.cashAfterCents)}`]
          : []),
        ...(projection.reserveBreached
          ? [
              `Leaves cash ${usdShort(state.reserveCents - projection.cashAfterCents)} below the minimum reserve`,
            ]
          : []),
      ],
      rows: diff.map((line) => [
        vendor(line.vendorId),
        usd(line.paidCents + line.remainingCents),
        usd(line.remainingCents),
        usd(line.paidCents),
      ]),
    })),
  };
}

function portfolio(): LabDomain {
  const state = driftedReserve();
  return {
    id: 'portfolio',
    name: 'Portfolio',
    mode: 'Dry run',
    adapter: 'portfolioAdapter',
    source: 'packages/domain-portfolio/src/adapter.ts',
    base: `${usdShort(state.cashCents)} cash, ${percent(state.maxWeightBps)} limit per position, ${usdShort(state.minCashCents)} minimum cash`,
    columns: ['Position', 'Weight before', 'Weight after', 'Units'],
    branches: fork(portfolioAdapter, state, referenceRebalances(), (branch) => ({
      figure: percent(branch.projection.largestWeightBps),
      figureName: 'largest position',
      stats: [
        `${usdShort(branch.projection.cashAfterCents)} cash`,
        `${usdShort(branch.projection.turnoverCents)} traded`,
        `${branch.actions.length} trade${branch.actions.length === 1 ? '' : 's'}`,
      ],
      reasons: branch.feasibility.reasons,
      rows: branch.diff.map((line) => {
        const change = line.unitsAfter - line.unitsBefore;
        return [
          line.name,
          percent(line.weightBeforeBps),
          percent(line.weightAfterBps),
          `${change > 0 ? '+' : '−'}${Math.abs(change)}`,
        ];
      }),
    })),
  };
}

export const labDomains = (): LabDomain[] => [treasury(), portfolio()];
