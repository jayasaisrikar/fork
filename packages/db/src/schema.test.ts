import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { approvals, proofRuns } from './schema';

describe('proof mode schema', () => {
  it('records approvals as human unless told otherwise', () => {
    const db = openDb(':memory:');
    const row = db
      .insert(approvals)
      .values({ branchId: 'b', approvedPlanHash: 'h', actor: 'cfo@example.test', at: 'now' })
      .returning()
      .get();
    expect(row.origin).toBe('human');
  });

  it('keeps a proof run row with safe defaults', () => {
    const db = openDb(':memory:');
    const row = db
      .insert(proofRuns)
      .values({ attack: 'altered_amount', startedAt: '2026-10-14T09:00:00.000Z' })
      .returning()
      .get();
    expect(row).toMatchObject({
      id: 1,
      finishedAt: null,
      result: null,
      integrityFailure: false,
      clearedAt: null,
    });
  });
});
