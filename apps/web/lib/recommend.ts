import { usdShort } from './format';
import type { Branch } from './types';

export interface Recommendation {
  branchId: string;
  reason: string;
}

// A recommendation is a judgement, so it is made by plain rules over FORK's own simulated
// numbers, never by the model. Priority: cover the critical bills, then avoid late fees, then
// keep the most cash, then need the fewest sign-offs.
const rank = (branch: Branch) => ({
  critical: branch.risk?.criticalDeferred.length ?? Number.POSITIVE_INFINITY,
  fees: branch.projection?.lateFeesCents ?? Number.POSITIVE_INFINITY,
  cash: -(branch.projection?.cashAfterCents ?? 0),
  signOffs: branch.risk?.approvalsNeeded ?? 0,
});

const feasibleOf = (branches: Branch[]) =>
  branches.filter(
    (branch) =>
      branch.status === 'SIMULATED' && branch.projection && branch.feasibility?.ok !== false,
  );

export function recommend(branches: Branch[]): Recommendation | null {
  const feasible = feasibleOf(branches);
  // nothing to recommend when there is no real choice
  if (feasible.length < 2) return null;

  const [pick] = [...feasible].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    return (
      left.critical - right.critical ||
      left.fees - right.fees ||
      left.cash - right.cash ||
      left.signOffs - right.signOffs
    );
  });
  if (!pick) return null;

  return { branchId: pick.id, reason: whyRecommended(pick, feasible) };
}

function whyRecommended(pick: Branch, feasible: Branch[]): string {
  const projection = pick.projection!;
  const critical = pick.risk?.criticalDeferred.length ?? 0;
  const others = feasible.filter((branch) => branch.id !== pick.id);
  const mostCash = Math.max(...feasible.map((branch) => branch.projection!.cashAfterCents));
  const cheapestFees = Math.min(...feasible.map((branch) => branch.projection!.lateFeesCents));

  const clauses = [
    critical === 0
      ? 'clears every critical bill'
      : `leaves ${critical} critical bill${critical === 1 ? '' : 's'} unpaid`,
    projection.cashAfterCents >= mostCash
      ? `keeps the most cash (${usdShort(projection.cashAfterCents)})`
      : `keeps ${usdShort(projection.cashAfterCents)} in the bank`,
  ];

  if (projection.lateFeesCents === 0) clauses.push('carries no late fees');
  else if (projection.lateFeesCents <= cheapestFees)
    clauses.push(`carries the lowest late fees (${usdShort(projection.lateFeesCents)})`);
  else clauses.push(`carries ${usdShort(projection.lateFeesCents)} in late fees`);

  if (others.length && (pick.risk?.approvalsNeeded ?? 0) === 0)
    clauses.push('needs no extra sign-off');

  const last = clauses.pop() ?? '';
  const body = clauses.length ? `${clauses.join(', ')} and ${last}` : last;
  return `It ${body}.`;
}