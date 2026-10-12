import { allocateProRata } from '@fork/shared';
import {
  openCents,
  type Allocation,
  type Criticality,
  type FeeRule,
  type TreasuryState,
} from './schema';

const flat = (dollars: number): FeeRule => ({ kind: 'flat', cents: dollars * 100 });
const percent = (bps: number): FeeRule => ({ kind: 'percent', bps });

type Row = [
  id: string,
  slug: string,
  name: string,
  dollars: number,
  due: string,
  fee: FeeRule,
  criticality: Criticality,
  note?: string,
];

const ROWS: Row[] = [
  ['INV-01', 'harbor', 'Harbor Hosting', 4000, '2026-10-13', flat(150), 'critical'],
  ['INV-02', 'northline', 'Northline Logistics', 8000, '2026-10-14', percent(100), 'important'],
  ['INV-03', 'meridian', 'Meridian Cloud', 11000, '2026-10-16', percent(150), 'important'],
  ['INV-04', 'beacon', 'Beacon Facilities', 6000, '2026-10-13', flat(250), 'critical'],
  [
    'INV-05',
    'alto',
    'Alto Manufacturing',
    17000,
    '2026-10-16',
    percent(200),
    'important',
    'Net-45 negotiable',
  ],
  [
    'INV-06',
    'juniper',
    'Juniper Payroll',
    12000,
    '2026-10-15',
    flat(0),
    'critical',
    'Payroll funding',
  ],
  ['INV-07', 'verve', 'Verve Design', 5000, '2026-10-16', flat(0), 'deferrable'],
  [
    'INV-08',
    'orchid',
    'Orchid Insurance',
    5000,
    '2026-10-16',
    flat(0),
    'deferrable',
    '30-day grace',
  ],
];

export const PROOF_SCENARIO = 'proof-sandbox';

// vendor and invoice ids are primary keys across scenarios, so a second scenario needs a prefix
function treasury(scenarioId: string, prefix = ''): TreasuryState {
  return {
    scenarioId,
    currency: 'USD',
    today: '2026-10-12',
    cashCents: 5_000_000,
    reserveCents: 800_000,
    holdAboveCents: 1_000_000,
    vendors: ROWS.map(([, slug, name]) => ({
      id: `${prefix}v-${slug}`,
      name,
      recipientId: `rcp-${slug}`,
      approved: true,
    })),
    invoices: ROWS.map(([id, slug, , dollars, dueDate, lateFee, criticality, note]) => ({
      id: `${prefix}${id}`,
      vendorId: `${prefix}v-${slug}`,
      amountCents: dollars * 100,
      paidCents: 0,
      dueDate,
      lateFee,
      criticality,
      note,
    })),
  };
}

// Kettle & Pine Supply Co. is fictional, and so is everyone it owes
export function liquidityShortfall(): TreasuryState {
  return treasury('liquidity-shortfall');
}

// the same books, kept apart for public security probes. nothing is ever paid from these.
export function proofSandbox(): TreasuryState {
  return treasury(PROOF_SCENARIO, 'proof-');
}

export interface ReferenceBranch {
  label: 'A' | 'B' | 'C';
  title: string;
  rationale: string;
  allocations: Allocation[];
}

// by vendor, so it holds for any id scheme
const DEFERRED_IN_B = ['meridian', 'alto'];
const deferredInB = (vendorId: string) =>
  DEFERRED_IN_B.some((slug) => vendorId.endsWith(`v-${slug}`));

// test fixture only. the product path always asks the planner.
export function referenceBranches(state: TreasuryState): ReferenceBranch[] {
  const open = state.invoices.map((invoice) => ({
    id: invoice.id,
    vendorId: invoice.vendorId,
    cents: openCents(invoice),
  }));
  const spendable = state.cashCents - state.reserveCents;
  const shares = allocateProRata(
    spendable,
    open.map(({ id, cents }) => ({ id, weight: cents })),
  );

  return [
    {
      label: 'A',
      title: 'Pay everything',
      rationale: 'Clears every invoice this week. It spends more cash than the company has.',
      allocations: open.map(({ id, cents }) => ({ invoiceId: id, payCents: cents })),
    },
    {
      label: 'B',
      title: 'Preserve runway',
      rationale:
        'Pays hosting, logistics, facilities, payroll, design and insurance in full. Defers Meridian and Alto and accepts their late fees.',
      allocations: open.map(({ id, vendorId, cents }) => ({
        invoiceId: id,
        payCents: deferredInB(vendorId) ? 0 : cents,
      })),
    },
    {
      label: 'C',
      title: 'Share the shortfall',
      rationale:
        'Spends everything above the reserve, split across all vendors by invoice size. Every vendor is left partly unpaid.',
      allocations: open.map(({ id }) => ({ invoiceId: id, payCents: shares.get(id) ?? 0 })),
    },
  ];
}
