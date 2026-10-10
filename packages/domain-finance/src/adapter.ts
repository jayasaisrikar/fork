import type { CanonicalToolStep, ForkDomainAdapter } from '@fork/harness';
import { LARGE_PAYMENT_TOOL, PAYMENT_TOOL, type Cents } from '@fork/shared';
import { validateAllocations, vendorOf, type Allocation, type TreasuryState } from './schema';
import { feasibility, simulate, type InvoiceLine, type Projection } from './simulate';

export interface PaymentReceipt {
  vendorId: string;
  amountCents: Cents;
}

// the exact MCP calls a branch turns into: check the balance, pay, look at the inbox after the
// first payment, check the balance again
function toToolSteps(
  state: TreasuryState,
  allocations: Allocation[],
  idempotencyPrefix: string,
): CanonicalToolStep[] {
  const read = (tool: string): CanonicalToolStep => ({
    tool,
    kind: 'read',
    args: { scenarioId: state.scenarioId },
  });
  const steps: CanonicalToolStep[] = [read('get_treasury_balance')];

  for (const { invoiceId, payCents } of allocations) {
    if (payCents <= 0) continue;
    const invoice = state.invoices.find((item) => item.id === invoiceId);
    const vendor = invoice && vendorOf(state, invoice);
    if (!invoice || !vendor) throw new Error(`${invoiceId} has no vendor on file`);

    const firstPayment = steps.length === 1;
    steps.push({
      tool: payCents > state.holdAboveCents ? LARGE_PAYMENT_TOOL : PAYMENT_TOOL,
      kind: 'write',
      args: {
        scenarioId: state.scenarioId,
        vendorId: vendor.id,
        recipientId: vendor.recipientId,
        amountCents: payCents,
        currency: state.currency,
        idempotencyKey: `${idempotencyPrefix}:${invoiceId}`,
      },
    });
    if (firstPayment) steps.push(read('get_sandbox_messages'));
  }

  steps.push(read('get_treasury_balance'));
  return steps;
}

export const financeAdapter: ForkDomainAdapter<
  TreasuryState,
  Allocation,
  Projection,
  InvoiceLine[],
  PaymentReceipt
> = {
  validateActions: validateAllocations,
  simulate,
  diff: (_base, projected) => projected.lines,
  feasibility,
  toToolSteps,
  // cash must have dropped by exactly what the receipts say
  verifyPostcondition(before, after, receipts) {
    const paid = receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0);
    const moved = before.cashCents - after.cashCents;
    return moved === paid
      ? { ok: true, problems: [] }
      : { ok: false, problems: [`Cash moved by ${moved} cents but receipts total ${paid} cents`] };
  },
};
