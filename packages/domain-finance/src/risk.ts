import type { Cents } from '@fork/shared';
import type { TreasuryState } from './schema';
import type { Projection } from './simulate';

export interface RiskAnnotations {
  reserveBreach: boolean;
  criticalDeferred: string[];
  lateFeeExposureCents: Cents;
  vendorsWithBalance: string[];
  approvalsNeeded: number;
}

// plain rules, no model involved
export function annotate(state: TreasuryState, projection: Projection): RiskAnnotations {
  const unpaid = projection.lines.filter((line) => line.remainingCents > 0);
  const critical = new Set(
    state.invoices
      .filter((invoice) => invoice.criticality === 'critical')
      .map((invoice) => invoice.id),
  );

  return {
    reserveBreach: projection.reserveBreached,
    criticalDeferred: unpaid
      .filter((line) => critical.has(line.invoiceId))
      .map((line) => line.invoiceId),
    lateFeeExposureCents: projection.lateFeesCents,
    vendorsWithBalance: [...new Set(unpaid.map((line) => line.vendorId))],
    approvalsNeeded: projection.lines.filter((line) => line.paidCents > state.holdAboveCents)
      .length,
  };
}
