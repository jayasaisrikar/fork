import type { Cents } from '@fork/shared';
import { z } from 'zod';

export type FeeRule = { kind: 'flat'; cents: Cents } | { kind: 'percent'; bps: number };
export type Criticality = 'critical' | 'important' | 'deferrable';

export interface Vendor {
  id: string;
  name: string;
  recipientId: string;
  approved: boolean;
}

export interface Invoice {
  id: string;
  vendorId: string;
  amountCents: Cents;
  paidCents: Cents;
  dueDate: string;
  lateFee: FeeRule;
  criticality: Criticality;
  note?: string;
}

export interface TreasuryState {
  scenarioId: string;
  currency: 'USD';
  today: string;
  cashCents: Cents;
  reserveCents: Cents;
  // payments above this wait for a human in ArmorIQ
  holdAboveCents: Cents;
  vendors: Vendor[];
  invoices: Invoice[];
}

export const AllocationSchema = z.strictObject({
  invoiceId: z.string().min(1),
  payCents: z.number().int().nonnegative(),
});
export type Allocation = z.infer<typeof AllocationSchema>;

export const BranchProposalSchema = z.object({
  branches: z
    .array(
      z.object({
        title: z.string().min(1).max(80),
        rationale: z.string().min(1).max(600),
        allocations: z.array(AllocationSchema).min(1),
      }),
    )
    .min(1)
    .max(3),
});
export type BranchProposal = z.infer<typeof BranchProposalSchema>;

export class AllocationError extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join('; '));
    this.name = 'AllocationError';
  }
}

export const openCents = (invoice: Invoice): Cents => invoice.amountCents - invoice.paidCents;

// returns one allocation per open invoice, in invoice order. anything left out is deferred.
export function validateAllocations(state: TreasuryState, input: unknown): Allocation[] {
  const parsed = z.array(AllocationSchema).safeParse(input);
  if (!parsed.success) {
    throw new AllocationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }

  const reasons: string[] = [];
  const pay = new Map<string, Cents>();
  for (const { invoiceId, payCents } of parsed.data) {
    const invoice = state.invoices.find((item) => item.id === invoiceId);
    if (!invoice) reasons.push(`${invoiceId} is not an open invoice`);
    else if (pay.has(invoiceId)) reasons.push(`${invoiceId} is listed twice`);
    else if (payCents > openCents(invoice)) reasons.push(`${invoiceId} is overpaid`);
    else if (payCents > 0 && !vendorOf(state, invoice)?.approved) {
      reasons.push(`${invoiceId} belongs to a vendor that is not approved`);
    }
    pay.set(invoiceId, payCents);
  }
  if (reasons.length) throw new AllocationError(reasons);

  return state.invoices
    .filter((invoice) => openCents(invoice) > 0)
    .map((invoice) => ({ invoiceId: invoice.id, payCents: pay.get(invoice.id) ?? 0 }));
}

export function vendorOf(state: TreasuryState, invoice: Invoice): Vendor | undefined {
  return state.vendors.find((vendor) => vendor.id === invoice.vendorId);
}
