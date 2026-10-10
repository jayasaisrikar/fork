import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const scenarios = sqliteTable('scenarios', {
  id: text().primaryKey(),
  name: text().notNull(),
  currency: text().notNull(),
  today: text().notNull(),
  reserveCents: integer().notNull(),
  holdAboveCents: integer().notNull(),
});

export const vendors = sqliteTable('vendors', {
  id: text().primaryKey(),
  scenarioId: text().notNull(),
  name: text().notNull(),
  recipientId: text().notNull(),
  approved: integer({ mode: 'boolean' }).notNull(),
});

export const invoices = sqliteTable('invoices', {
  id: text().primaryKey(),
  scenarioId: text().notNull(),
  vendorId: text().notNull(),
  amountCents: integer().notNull(),
  paidCents: integer().notNull(),
  dueDate: text().notNull(),
  feeKind: text({ enum: ['flat', 'percent'] }).notNull(),
  // cents for flat, basis points for percent
  feeValue: integer().notNull(),
  criticality: text({ enum: ['critical', 'important', 'deferrable'] }).notNull(),
  note: text(),
});

// append-only, a trigger refuses updates and deletes
export const ledgerPostings = sqliteTable('ledger_postings', {
  id: integer().primaryKey({ autoIncrement: true }),
  entryId: text().notNull(),
  scenarioId: text().notNull(),
  account: text({ enum: ['cash', 'accounts_payable', 'equity'] }).notNull(),
  amountCents: integer().notNull(),
  receiptId: text(),
  at: text().notNull(),
});

export const receipts = sqliteTable('receipts', {
  id: text().primaryKey(),
  scenarioId: text().notNull(),
  vendorId: text().notNull(),
  recipientId: text().notNull(),
  amountCents: integer().notNull(),
  currency: text().notNull(),
  idempotencyKey: text().notNull().unique(),
  capabilityId: text().notNull(),
  at: text().notNull(),
});

export const usedCapabilities = sqliteTable('used_capabilities', {
  id: text().primaryKey(),
  usedAt: text().notNull(),
});

export const messages = sqliteTable('messages', {
  id: text().primaryKey(),
  scenarioId: text().notNull(),
  from: text().notNull(),
  subject: text().notNull(),
  body: text().notNull(),
  receivedAt: text().notNull(),
  untrusted: integer({ mode: 'boolean' }).notNull().default(true),
});
