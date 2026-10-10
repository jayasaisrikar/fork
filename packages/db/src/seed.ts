import { liquidityShortfall, type TreasuryState } from '@fork/domain-finance';
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { postEntry } from './ledger';
import { invoices, scenarios, vendors } from './schema';

// safe to run twice: a scenario that already exists is left alone
export function seedScenario(db: Db, state: TreasuryState = liquidityShortfall()): boolean {
  return db.transaction(
    (tx) => {
      const existing = tx.select().from(scenarios).where(eq(scenarios.id, state.scenarioId)).get();
      if (existing) return false;

      tx.insert(scenarios)
        .values({
          id: state.scenarioId,
          name: 'Liquidity Shortfall',
          currency: state.currency,
          today: state.today,
          reserveCents: state.reserveCents,
          holdAboveCents: state.holdAboveCents,
        })
        .run();
      tx.insert(vendors)
        .values(state.vendors.map((vendor) => ({ ...vendor, scenarioId: state.scenarioId })))
        .run();
      tx.insert(invoices)
        .values(
          state.invoices.map((invoice) => ({
            id: invoice.id,
            scenarioId: state.scenarioId,
            vendorId: invoice.vendorId,
            amountCents: invoice.amountCents,
            paidCents: invoice.paidCents,
            dueDate: invoice.dueDate,
            feeKind: invoice.lateFee.kind,
            feeValue: invoice.lateFee.kind === 'flat' ? invoice.lateFee.cents : invoice.lateFee.bps,
            criticality: invoice.criticality,
            note: invoice.note,
          })),
        )
        .run();

      // opening books: cash on hand, what is owed, and equity as the balancing figure
      const owed = state.invoices.reduce(
        (sum, invoice) => sum + invoice.amountCents - invoice.paidCents,
        0,
      );
      postEntry(
        tx,
        state.scenarioId,
        [
          { account: 'cash', amountCents: state.cashCents },
          { account: 'accounts_payable', amountCents: -owed },
          { account: 'equity', amountCents: owed - state.cashCents },
        ],
        `${state.today}T00:00:00.000Z`,
      );
      return true;
    },
    { behavior: 'immediate' },
  );
}
