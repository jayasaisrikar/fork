import {
  balanceCents,
  cashCents,
  loadState,
  openDb,
  schema,
  seedAll,
  seedScenario,
} from '@fork/db';
import { PROOF_SCENARIO } from '@fork/domain-finance';
import { LARGE_PAYMENT_TOOL, PAYMENT_TOOL, type PaymentTool } from '@fork/shared';
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
    const pay = (vendor: string, dollars: number, tool: PaymentTool) =>
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
        tool,
      );

    expect(pay('alto', 17000, LARGE_PAYMENT_TOOL).ok).toBe(true);
    expect(pay('juniper', 12000, LARGE_PAYMENT_TOOL).ok).toBe(true);
    expect(pay('meridian', 11000, LARGE_PAYMENT_TOOL).ok).toBe(true);
    expect(pay('northline', 8000, PAYMENT_TOOL).ok).toBe(true);
    expect(cashCents(db, SCENARIO)).toBe(200_000);
    expect(pay('harbor', 4000, PAYMENT_TOOL)).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_CASH',
    });
    expect(cashCents(db, SCENARIO)).toBe(200_000);
  });

  it('makes payments over the threshold use the held tool, and only those', () => {
    const db = fresh();
    const juniper = payment({
      vendorId: 'v-juniper',
      recipientId: 'rcp-juniper',
      amount: 12000,
      amountCents: 1_200_000,
    });
    expect(executePayment(db, SECRET, juniper, NOW, PAYMENT_TOOL)).toMatchObject({
      ok: false,
      code: 'WRONG_PAYMENT_TOOL',
    });
    expect(executePayment(db, SECRET, payment(), NOW, LARGE_PAYMENT_TOOL)).toMatchObject({
      ok: false,
      code: 'WRONG_PAYMENT_TOOL',
    });
    expect(cashCents(db, SCENARIO)).toBe(5_000_000);

    expect(executePayment(db, SECRET, juniper, NOW, LARGE_PAYMENT_TOOL).ok).toBe(true);
    expect(cashCents(db, SCENARIO)).toBe(3_800_000);
  });
});

describe('the proof sandbox is read-only', () => {
  function both() {
    const db = openDb(':memory:');
    seedAll(db);
    return db;
  }
  const sandbox = (overrides: Partial<PaymentParams> = {}) =>
    payment({ scenarioId: PROOF_SCENARIO, vendorId: 'proof-v-harbor', ...overrides });
  const count = (db: ReturnType<typeof both>, table: string) =>
    db.get<{ n: number }>(sql.raw(`select count(*) as n from ${table}`)).n;

  it('refuses a completely valid payment before writing anything', () => {
    const db = both();
    const before = postings(db);
    const result = executePayment(db, SECRET, sandbox(), NOW);
    expect(result).toMatchObject({ ok: false, code: 'PROOF_SANDBOX_READ_ONLY' });
    expect(postings(db)).toBe(before);
    expect(count(db, 'receipts')).toBe(0);
    expect(count(db, 'used_capabilities')).toBe(0);
    expect(cashCents(db, PROOF_SCENARIO)).toBe(5_000_000);
    expect(
      loadState(db, PROOF_SCENARIO)!.invoices.every((invoice) => invoice.paidCents === 0),
    ).toBe(true);
  });

  it('refuses the large payment tool as well', () => {
    const db = both();
    const large = sandbox({
      vendorId: 'proof-v-juniper',
      recipientId: 'rcp-juniper',
      amount: 12000,
      amountCents: 1_200_000,
    });
    expect(executePayment(db, SECRET, large, NOW, LARGE_PAYMENT_TOOL)).toMatchObject({
      ok: false,
      code: 'PROOF_SANDBOX_READ_ONLY',
    });
    expect(count(db, 'receipts')).toBe(0);
  });

  it('still calls altered arguments invalid first', () => {
    const db = both();
    const approved = sandbox();
    for (const altered of [
      { ...approved, amount: 5000, amountCents: 500_000 },
      { ...approved, recipientId: 'recipient-external-999' },
    ])
      expect(executePayment(db, SECRET, altered, NOW)).toMatchObject({
        ok: false,
        code: 'CAPABILITY_INVALID',
      });
  });

  it('leaves treasury payments exactly as they were', () => {
    const db = both();
    expect(executePayment(db, SECRET, payment(), NOW)).toMatchObject({ ok: true, replayed: false });
    expect(cashCents(db, SCENARIO)).toBe(4_600_000);
    expect(cashCents(db, PROOF_SCENARIO)).toBe(5_000_000);
  });
});
