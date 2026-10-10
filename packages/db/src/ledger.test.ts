import {
  liquidityShortfall,
  referenceBranches,
  simulate,
  validateAllocations,
} from '@fork/domain-finance';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { balanceCents, cashCents, loadState, postEntry } from './ledger';
import { ledgerPostings } from './schema';
import { seedScenario } from './seed';

const SCENARIO = 'liquidity-shortfall';

function fresh() {
  const db = openDb(':memory:');
  seedScenario(db);
  return db;
}

const TABLES = [
  'scenarios',
  'vendors',
  'invoices',
  'ledger_postings',
  'receipts',
  'used_capabilities',
  'messages',
];
const rowCounts = (db: ReturnType<typeof fresh>) =>
  TABLES.map((table) => db.get<{ n: number }>(sql.raw(`select count(*) as n from ${table}`)).n);

describe('seed', () => {
  it('opens the books at $50,000 cash and $68,000 owed', () => {
    const db = fresh();
    expect(cashCents(db, SCENARIO)).toBe(5_000_000);
    expect(balanceCents(db, SCENARIO, 'accounts_payable')).toBe(-6_800_000);
  });

  it('is idempotent', () => {
    const db = fresh();
    const before = rowCounts(db);
    expect(seedScenario(db)).toBe(false);
    expect(rowCounts(db)).toEqual(before);
  });

  it('round-trips the scenario through the database', () => {
    expect(loadState(fresh(), SCENARIO)).toEqual(liquidityShortfall());
  });
});

describe('ledger', () => {
  it('balances to zero overall', () => {
    const db = fresh();
    const total = db.get<{ n: number }>(sql`select sum(amountCents) as n from ledger_postings`).n;
    expect(total).toBe(0);
  });

  it('refuses an entry that does not balance', () => {
    const db = fresh();
    const lines = [
      { account: 'cash' as const, amountCents: -100 },
      { account: 'accounts_payable' as const, amountCents: 99 },
    ];
    expect(() => postEntry(db, SCENARIO, lines, 'now')).toThrow(/off by/);
  });

  it('is append-only', () => {
    const db = fresh();
    expect(() => db.update(ledgerPostings).set({ amountCents: 1 }).run()).toThrow(/append-only/);
    expect(() => db.delete(ledgerPostings).run()).toThrow(/append-only/);
  });
});

describe('simulation', () => {
  it('never writes', () => {
    const db = fresh();
    const state = loadState(db, SCENARIO)!;
    const before = rowCounts(db);
    for (const branch of referenceBranches(state))
      simulate(state, validateAllocations(state, branch.allocations));
    expect(rowCounts(db)).toEqual(before);
    expect(cashCents(db, SCENARIO)).toBe(5_000_000);
  });
});
