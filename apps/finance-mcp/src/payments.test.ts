import { balanceCents, cashCents, loadState, openDb, schema, seedScenario } from '@fork/db';
import { mintCapability, paymentArgsHash } from '@fork/shared/capability';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { executePayment, type PaymentParams } from './payments';

const SECRET = 'test-capability-secret';
const SCENARIO = 'liquidity-shortfall';
const NOW = new Date('2026-10-12T09:00:00Z');
const LATER = Math.floor(NOW.getTime() / 1000) + 600;

function fresh() {
  const db = openDb(':memory:');
  seedScenario(db);
  return db;
}

let step = 0;
function payment(
  overrides: Partial<PaymentParams> = {},
  secret = SECRET,
  exp = LATER,
): PaymentParams {
  const args = {
    scenarioId: SCENARIO,
    vendorId: 'v-harbor',
    recipientId: 'rcp-harbor',
    amount: 4000,
    amountCents: 400_000,
    currency: 'USD' as const,
    idempotencyKey: `key-${++step}`,
    ...overrides,
  };
  const approvedExecutionRef =
    overrides.approvedExecutionRef ??
    mintCapability(secret, { runId: 'run-1', stepIndex: step, exp }, paymentArgsHash(args));
  return { ...args, approvedExecutionRef };
}

const postings = (db: ReturnType<typeof fresh>) =>
  db.get<{ n: number }>(sql`select count(*) as n from ledger_postings`).n;

function expectDenied(db: ReturnType<typeof fresh>, params: PaymentParams, code: string) {
  const before = postings(db);
  const result = executePayment(db, SECRET, params, NOW);
  expect(result).toMatchObject({ ok: false, code });
  expect(postings(db)).toBe(before);
  expect(cashCents(db, SCENARIO)).toBe(5_000_000);
}

describe('a valid payment', () => {
  it('writes once and returns a receipt', () => {
    const db = fresh();
    const result = executePayment(db, SECRET, payment(), NOW);

    expect(result).toMatchObject({
      ok: true,
      replayed: false,
      receipt: { amountCents: 400_000, recipientId: 'rcp-harbor' },
    });
    expect(cashCents(db, SCENARIO)).toBe(4_600_000);
    expect(balanceCents(db, SCENARIO, 'accounts_payable')).toBe(-6_400_000);
    expect(db.get<{ n: number }>(sql`select sum(amountCents) as n from ledger_postings`).n).toBe(0);
    expect(
      loadState(db, SCENARIO)!.invoices.find((invoice) => invoice.id === 'INV-01')!.paidCents,
    ).toBe(400_000);
  });

  it('returns the same receipt for a retry and does not pay twice', () => {
    const db = fresh();
    const params = payment();
    const first = executePayment(db, SECRET, params, NOW);
    const retry = executePayment(db, SECRET, params, NOW);

    expect(first.ok && retry.ok && retry.receipt.id === first.receipt.id).toBe(true);
    expect(retry).toMatchObject({ replayed: true });
    expect(cashCents(db, SCENARIO)).toBe(4_600_000);
    expect(db.select().from(schema.receipts).all()).toHaveLength(1);
  });

  it('accepts a partial payment', () => {
    const db = fresh();
    expect(
      executePayment(db, SECRET, payment({ amount: 2470.59, amountCents: 247_059 }), NOW).ok,
    ).toBe(true);
    expect(cashCents(db, SCENARIO)).toBe(5_000_000 - 247_059);
  });
});

describe('capability checks', () => {
  it('denies a missing or junk capability', () => {
    expectDenied(fresh(), payment({ approvedExecutionRef: 'spike' }), 'CAPABILITY_INVALID');
  });

  it('denies a capability signed with another secret', () => {
    expectDenied(fresh(), payment({}, 'attacker-secret'), 'CAPABILITY_INVALID');
  });

  it('denies an expired capability', () => {
    expectDenied(fresh(), payment({}, SECRET, LATER - 601), 'CAPABILITY_EXPIRED');
  });

  it('denies a capability reused for a second payment', () => {
    const db = fresh();
    const params = payment({
      vendorId: 'v-northline',
      recipientId: 'rcp-northline',
      amount: 1000,
      amountCents: 100_000,
    });
    expect(executePayment(db, SECRET, params, NOW).ok).toBe(true);

    // same capability, new idempotency key: the args hash no longer matches
    const again = executePayment(db, SECRET, { ...params, idempotencyKey: 'another' }, NOW);
    expect(again).toMatchObject({ ok: false, code: 'CAPABILITY_INVALID' });
    expect(cashCents(db, SCENARIO)).toBe(4_900_000);
  });

  it('denies altered args under a capability minted for the approved ones', () => {
    const db = fresh();
    const approved = payment({
      vendorId: 'v-northline',
      recipientId: 'rcp-northline',
      amount: 8000,
      amountCents: 800_000,
    });
    expectDenied(db, { ...approved, recipientId: 'recipient-external-999' }, 'CAPABILITY_INVALID');
    expectDenied(db, { ...approved, amount: 9000, amountCents: 900_000 }, 'CAPABILITY_INVALID');
  });
});

describe('payment checks', () => {
  it('denies a recipient that is not the registered one, even with a matching capability', () => {
    expectDenied(
      fresh(),
      payment({ vendorId: 'v-northline', recipientId: 'recipient-external-999' }),
      'RECIPIENT_MISMATCH',
    );
  });

  it('denies an unknown vendor', () => {
    expectDenied(
      fresh(),
      payment({ vendorId: 'v-nobody', recipientId: 'rcp-nobody' }),
      'VENDOR_NOT_APPROVED',
    );
  });

  it('denies amount and amountCents that disagree', () => {
    expectDenied(fresh(), payment({ amount: 40, amountCents: 400_000 }), 'AMOUNT_MISMATCH');
  });

  it('denies paying a vendor more than it is owed', () => {
    expectDenied(
      fresh(),
      payment({ amount: 4000.01, amountCents: 400_001 }),
      'EXCEEDS_OPEN_BALANCE',
    );
  });

  it('never lets cash go negative', () => {
    const db = fresh();
    const pay = (vendor: string, dollars: number) =>
      executePayment(
        db,
        SECRET,
        payment({
          vendorId: `v-${vendor}`,
          recipientId: `rcp-${vendor}`,
          amount: dollars,
          amountCents: dollars * 100,
        }),
        NOW,
      );

    for (const [vendor, dollars] of [
      ['alto', 17000],
      ['juniper', 12000],
      ['meridian', 11000],
      ['northline', 8000],
    ] as const) {
      expect(pay(vendor, dollars).ok).toBe(true);
    }
    expect(cashCents(db, SCENARIO)).toBe(200_000);
    expect(pay('harbor', 4000)).toMatchObject({ ok: false, code: 'INSUFFICIENT_CASH' });
    expect(cashCents(db, SCENARIO)).toBe(200_000);
  });
});
