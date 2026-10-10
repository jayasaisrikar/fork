import type { Cents } from '@fork/shared';
import { openCents, type Allocation, type Invoice, type TreasuryState } from './schema';

export const WINDOW_DAYS = 14;

export interface InvoiceLine {
  invoiceId: string;
  vendorId: string;
  paidCents: Cents;
  remainingCents: Cents;
  lateFeeCents: Cents;
}

export interface Projection {
  outflowCents: Cents;
  cashAfterCents: Cents;
  lowestCashCents: Cents;
  reserveBreached: boolean;
  deferredCents: Cents;
  lateFeesCents: Cents;
  lines: InvoiceLine[];
  cashPath: { date: string; cashCents: Cents }[];
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

// charged once on whatever is still unpaid, if the due date falls inside the window
function lateFee(invoice: Invoice, remaining: Cents, windowEnd: string): Cents {
  if (remaining <= 0 || invoice.dueDate >= windowEnd) return 0;
  if (invoice.lateFee.kind === 'flat') return invoice.lateFee.cents;
  return Math.floor((remaining * invoice.lateFee.bps + 5000) / 10_000);
}

const sum = (values: Cents[]) => values.reduce((total, value) => total + value, 0);

// pure. expects allocations that already went through validateAllocations.
export function simulate(state: TreasuryState, allocations: Allocation[]): Projection {
  const windowEnd = addDays(state.today, WINDOW_DAYS);
  const pay = new Map(allocations.map((item) => [item.invoiceId, item.payCents]));

  const lines = state.invoices
    .filter((invoice) => openCents(invoice) > 0)
    .map((invoice) => {
      const paidCents = pay.get(invoice.id) ?? 0;
      const remainingCents = openCents(invoice) - paidCents;
      return {
        invoiceId: invoice.id,
        vendorId: invoice.vendorId,
        paidCents,
        remainingCents,
        lateFeeCents: lateFee(invoice, remainingCents, windowEnd),
      };
    });

  const outflowCents = sum(lines.map((line) => line.paidCents));
  const cashAfterCents = state.cashCents - outflowCents;

  // payments all go out today, so the path steps down once and stays there
  const cashPath = Array.from({ length: WINDOW_DAYS }, (_, day) => ({
    date: addDays(state.today, day),
    cashCents: day === 0 ? state.cashCents : cashAfterCents,
  }));

  return {
    outflowCents,
    cashAfterCents,
    lowestCashCents: Math.min(state.cashCents, cashAfterCents),
    reserveBreached: cashAfterCents < state.reserveCents,
    deferredCents: sum(lines.map((line) => line.remainingCents)),
    lateFeesCents: sum(lines.map((line) => line.lateFeeCents)),
    lines,
    cashPath,
  };
}

export function feasibility(state: TreasuryState, projection: Projection) {
  const reasons: string[] = [];
  if (projection.cashAfterCents < 0) {
    reasons.push(`Overdraws the account by ${-projection.cashAfterCents} cents`);
  }
  if (projection.reserveBreached) {
    const short = state.reserveCents - projection.cashAfterCents;
    reasons.push(`Leaves cash ${short} cents below the minimum reserve`);
  }
  return { ok: reasons.length === 0, reasons };
}
