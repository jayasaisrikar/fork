import { randomUUID } from 'node:crypto';
import type { FeeRule, TreasuryState } from '@fork/domain-finance';
import type { Cents } from '@fork/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { invoices, ledgerPostings, scenarios, vendors } from './schema';

type Account = (typeof ledgerPostings.$inferInsert)['account'];

export interface PostingLine {
  account: Account;
  amountCents: Cents;
}

// one balanced entry. refuses anything that does not sum to zero.
export function postEntry(
  tx: Db | Tx,
  scenarioId: string,
  lines: PostingLine[],
  at: string,
  receiptId?: string,
): string {
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (total !== 0) throw new Error(`entry is off by ${total} cents`);
  if (lines.some((line) => !Number.isInteger(line.amountCents)))
    throw new Error('postings must be whole cents');

  const entryId = randomUUID();
  tx.insert(ledgerPostings)
    .values(lines.map((line) => ({ ...line, entryId, scenarioId, receiptId, at })))
    .run();
  return entryId;
}

export function balanceCents(db: Db | Tx, scenarioId: string, account: Account): Cents {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${ledgerPostings.amountCents}), 0)` })
    .from(ledgerPostings)
    .where(and(eq(ledgerPostings.scenarioId, scenarioId), eq(ledgerPostings.account, account)))
    .get();
  return row?.total ?? 0;
}

export const cashCents = (db: Db | Tx, scenarioId: string) => balanceCents(db, scenarioId, 'cash');

// the books as the simulator wants them
export function loadState(db: Db | Tx, scenarioId: string): TreasuryState | undefined {
  const scenario = db.select().from(scenarios).where(eq(scenarios.id, scenarioId)).get();
  if (!scenario) return undefined;

  const vendorRows = db.select().from(vendors).where(eq(vendors.scenarioId, scenarioId)).all();
  const invoiceRows = db
    .select()
    .from(invoices)
    .where(eq(invoices.scenarioId, scenarioId))
    .orderBy(invoices.id)
    .all();

  return {
    scenarioId,
    currency: 'USD',
    today: scenario.today,
    cashCents: cashCents(db, scenarioId),
    reserveCents: scenario.reserveCents,
    holdAboveCents: scenario.holdAboveCents,
    vendors: vendorRows.map(({ id, name, recipientId, approved }) => ({
      id,
      name,
      recipientId,
      approved,
    })),
    invoices: invoiceRows.map((row) => ({
      id: row.id,
      vendorId: row.vendorId,
      amountCents: row.amountCents,
      paidCents: row.paidCents,
      dueDate: row.dueDate,
      lateFee: toFeeRule(row.feeKind, row.feeValue),
      criticality: row.criticality,
      note: row.note ?? undefined,
    })),
  };
}

const toFeeRule = (kind: 'flat' | 'percent', value: number): FeeRule =>
  kind === 'flat' ? { kind, cents: value } : { kind, bps: value };
