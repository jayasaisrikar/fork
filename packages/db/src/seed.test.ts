import { PROOF_SCENARIO } from '@fork/domain-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { cashCents } from './ledger';
import { scenarios } from './schema';
import { seedAll } from './seed';

describe('seedAll', () => {
  it('seeds the treasury and the proof sandbox side by side, once', () => {
    const db = openDb(':memory:');
    seedAll(db);
    seedAll(db);
    expect(cashCents(db, 'liquidity-shortfall')).toBe(5_000_000);
    expect(cashCents(db, PROOF_SCENARIO)).toBe(5_000_000);
    expect(db.select().from(scenarios).where(eq(scenarios.id, PROOF_SCENARIO)).get()?.name).toBe(
      'Proof sandbox',
    );
    expect(db.select().from(scenarios).all()).toHaveLength(2);
  });
});
