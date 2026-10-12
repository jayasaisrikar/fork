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

export const sessions = sqliteTable('sessions', {
  id: text().primaryKey(),
  email: text().notNull(),
  csrfToken: text().notNull(),
  expiresAt: text().notNull(),
});

// a frozen copy of the books that every branch in a run is simulated against
export const snapshots = sqliteTable('snapshots', {
  id: text().primaryKey(),
  scenarioId: text().notNull(),
  hash: text().notNull(),
  state: text({ mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text().notNull(),
});

export const runs = sqliteTable('runs', {
  id: integer().primaryKey({ autoIncrement: true }),
  domain: text().notNull(),
  scenarioId: text().notNull(),
  baseSnapshotId: text().notNull(),
  actor: text().notNull(),
  createdAt: text().notNull(),
});

export const branches = sqliteTable('branches', {
  id: text().primaryKey(),
  runId: integer().notNull(),
  parentId: text(),
  version: integer().notNull(),
  label: text().notNull(),
  title: text().notNull(),
  rationale: text().notNull(),
  source: text({ enum: ['agent', 'fixture', 'replan'] }).notNull(),
  baseSnapshotHash: text().notNull(),
  actions: text({ mode: 'json' }).$type<unknown>().notNull(),
  projection: text({ mode: 'json' }).$type<unknown>(),
  feasibility: text({ mode: 'json' }).$type<{ ok: boolean; reasons: string[] }>(),
  risk: text({ mode: 'json' }).$type<unknown>(),
  approvedPlanHash: text(),
  status: text().notNull(),
  createdAt: text().notNull(),
});

// the exact steps frozen at authorization
export const branchActions = sqliteTable('branch_actions', {
  id: integer().primaryKey({ autoIncrement: true }),
  branchId: text().notNull(),
  stepIndex: integer().notNull(),
  tool: text().notNull(),
  kind: text({ enum: ['read', 'write'] }).notNull(),
  args: text({ mode: 'json' }).$type<Record<string, string | number>>().notNull(),
  capability: text(),
});

export const approvals = sqliteTable('approvals', {
  id: integer().primaryKey({ autoIncrement: true }),
  branchId: text().notNull(),
  approvedPlanHash: text().notNull(),
  actor: text().notNull(),
  // who stood behind this approval. a system approval can be probed but never executed.
  origin: text({ enum: ['human', 'system'] })
    .notNull()
    .default('human'),
  at: text().notNull(),
  revokedAt: text(),
});

export const executions = sqliteTable('executions', {
  id: text().primaryKey(),
  runId: integer().notNull(),
  branchId: text().notNull(),
  kind: text({ enum: ['commit', 'tamper_test'] }).notNull(),
  approvedPlanHash: text().notNull(),
  armorPlanId: text().notNull(),
  armorPlanHash: text().notNull(),
  merkleRoot: text().notNull(),
  tokenId: text().notNull(),
  expiresAt: text().notNull(),
  status: text({ enum: ['RUNNING', 'DONE'] }).notNull(),
  createdAt: text().notNull(),
});

export const executionSteps = sqliteTable('execution_steps', {
  id: integer().primaryKey({ autoIncrement: true }),
  executionId: text().notNull(),
  runId: integer().notNull(),
  branchId: text().notNull(),
  // null for attempts that were never part of the approved plan
  stepIndex: integer(),
  origin: text({ enum: ['runner', 'tamper_test', 'agent'] }).notNull(),
  tool: text().notNull(),
  kind: text({ enum: ['read', 'write'] }).notNull(),
  args: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  requestedArgsHash: text().notNull(),
  verdict: text(),
  source: text({ enum: ['armoriq', 'fork', 'mcp'] }),
  errorClass: text(),
  message: text(),
  delegationId: text(),
  receiptId: text(),
  latencyMs: integer(),
  status: text().notNull(),
  at: text().notNull(),
});

// append-only, same trigger treatment as the ledger
export const auditEvents = sqliteTable('audit_events', {
  id: integer().primaryKey({ autoIncrement: true }),
  runId: integer(),
  at: text().notNull(),
  actor: text().notNull(),
  source: text({ enum: ['agent', 'fork', 'armoriq', 'mcp', 'ledger', 'human'] }).notNull(),
  type: text().notNull(),
  refs: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  payload: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull(),
});

// one row per public proof probe. the cooldown, the daily cap and the fail-closed switch read it.
export const proofRuns = sqliteTable('proof_runs', {
  id: integer().primaryKey({ autoIncrement: true }),
  attack: text().notNull(),
  // a short hash of the caller as the trusted edge saw it. null when there is no trusted edge.
  client: text(),
  startedAt: text().notNull(),
  finishedAt: text(),
  result: text({ mode: 'json' }).$type<unknown>(),
  // set when a probe left a ledger posting behind. proof mode stays off until an admin clears it.
  integrityFailure: integer({ mode: 'boolean' }).notNull().default(false),
  clearedAt: text(),
});
