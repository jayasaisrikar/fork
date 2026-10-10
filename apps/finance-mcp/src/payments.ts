import { randomUUID } from 'node:crypto';
import { cashCents, postEntry, schema, type Db } from '@fork/db';
import { paymentArgsHash, verifyCapability } from '@fork/shared/capability';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const { invoices, receipts, usedCapabilities, vendors } = schema;

export const PaymentInput = {
  scenarioId: z.string().min(1),
  vendorId: z.string().min(1),
  recipientId: z.string().min(1),
  // dollars, the field ArmorIQ reads. amountCents is what we trust.
  amount: z.number().positive(),
  amountCents: z.number().int().positive(),
  currency: z.literal('USD'),
  idempotencyKey: z.string().min(1),
  approvedExecutionRef: z.string().min(1),
};
export type PaymentParams = z.infer<z.ZodObject<typeof PaymentInput>>;

export type Receipt = typeof receipts.$inferSelect;

export type DenyCode =
  | 'CAPABILITY_INVALID'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_USED'
  | 'VENDOR_NOT_APPROVED'
  | 'RECIPIENT_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'EXCEEDS_OPEN_BALANCE'
  | 'INSUFFICIENT_CASH';

export type PaymentResult =
  | { ok: true; receipt: Receipt; replayed: boolean }
  | { ok: false; code: DenyCode; message: string };

const deny = (code: DenyCode, message: string): PaymentResult => ({ ok: false, code, message });

// every check and every write happens in one immediate transaction. the first failure writes nothing.
export function executePayment(
  db: Db,
  secret: string,
  params: PaymentParams,
  now = new Date(),
): PaymentResult {
  return db.transaction(
    (tx) => {
      const capability = verifyCapability(
        secret,
        params.approvedExecutionRef,
        paymentArgsHash(params),
        Math.floor(now.getTime() / 1000),
      );
      if (!capability.ok) {
        return capability.reason === 'expired'
          ? deny('CAPABILITY_EXPIRED', 'The execution capability has expired')
          : deny('CAPABILITY_INVALID', 'The execution capability does not match this payment');
      }

      const byKey = tx
        .select()
        .from(receipts)
        .where(eq(receipts.idempotencyKey, params.idempotencyKey))
        .get();
      const used = tx
        .select()
        .from(usedCapabilities)
        .where(eq(usedCapabilities.id, capability.id))
        .get();
      if (used) {
        // an exact retry of a payment that already went through gets its receipt back
        if (byKey?.capabilityId === capability.id)
          return { ok: true, receipt: byKey, replayed: true };
        return deny('CAPABILITY_USED', 'The execution capability was already used');
      }

      const vendor = tx
        .select()
        .from(vendors)
        .where(and(eq(vendors.id, params.vendorId), eq(vendors.scenarioId, params.scenarioId)))
        .get();
      if (!vendor?.approved)
        return deny('VENDOR_NOT_APPROVED', `${params.vendorId} is not an approved vendor`);
      if (vendor.recipientId !== params.recipientId) {
        return deny(
          'RECIPIENT_MISMATCH',
          `${params.recipientId} is not the registered recipient for ${vendor.id}`,
        );
      }

      if (params.amountCents !== Math.round(params.amount * 100)) {
        return deny('AMOUNT_MISMATCH', 'amount and amountCents disagree');
      }

      const open = tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.vendorId, vendor.id), eq(invoices.scenarioId, params.scenarioId)))
        .orderBy(invoices.dueDate, invoices.id)
        .all()
        .filter((invoice) => invoice.amountCents > invoice.paidCents);
      const owed = open.reduce((sum, invoice) => sum + invoice.amountCents - invoice.paidCents, 0);
      if (params.amountCents > owed) {
        return deny(
          'EXCEEDS_OPEN_BALANCE',
          `${vendor.id} is owed ${owed} cents, less than this payment`,
        );
      }

      if (cashCents(tx, params.scenarioId) - params.amountCents < 0) {
        return deny('INSUFFICIENT_CASH', 'This payment would overdraw the account');
      }

      if (byKey) return { ok: true, receipt: byKey, replayed: true };

      const at = now.toISOString();
      const receipt: Receipt = {
        id: `rcpt_${randomUUID()}`,
        scenarioId: params.scenarioId,
        vendorId: vendor.id,
        recipientId: vendor.recipientId,
        amountCents: params.amountCents,
        currency: params.currency,
        idempotencyKey: params.idempotencyKey,
        capabilityId: capability.id,
        at,
      };
      tx.insert(usedCapabilities).values({ id: capability.id, usedAt: at }).run();
      postEntry(
        tx,
        params.scenarioId,
        [
          { account: 'cash', amountCents: -params.amountCents },
          { account: 'accounts_payable', amountCents: params.amountCents },
        ],
        at,
        receipt.id,
      );

      // oldest invoice first
      let left = params.amountCents;
      for (const invoice of open) {
        if (left === 0) break;
        const applied = Math.min(left, invoice.amountCents - invoice.paidCents);
        tx.update(invoices)
          .set({ paidCents: invoice.paidCents + applied })
          .where(eq(invoices.id, invoice.id))
          .run();
        left -= applied;
      }

      tx.insert(receipts).values(receipt).run();
      return { ok: true, receipt, replayed: false };
    },
    { behavior: 'immediate' },
  );
}
