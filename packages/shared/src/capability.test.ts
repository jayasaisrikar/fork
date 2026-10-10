import { describe, expect, it } from 'vitest';
import { mintCapability, paymentArgsHash, verifyCapability } from './capability';

const secret = 'test-secret';
const args = {
  scenarioId: 's',
  vendorId: 'v-harbor',
  recipientId: 'rcp-harbor',
  amountCents: 400_000,
  currency: 'USD',
  idempotencyKey: 'k1',
};
const claims = { runId: 'run-1', stepIndex: 2, exp: 2000 };
const token = mintCapability(secret, claims, paymentArgsHash(args));

describe('capability', () => {
  it('verifies for the exact args it was minted for', () => {
    const check = verifyCapability(secret, token, paymentArgsHash(args), 1000);
    expect(check).toMatchObject({ ok: true, claims });
  });

  it.each([
    ['recipient', { ...args, recipientId: 'recipient-external-999' }],
    ['amount', { ...args, amountCents: 400_001 }],
    ['vendor', { ...args, vendorId: 'v-alto' }],
    ['idempotency key', { ...args, idempotencyKey: 'k2' }],
  ])('is forged for a different %s', (_name, altered) => {
    expect(verifyCapability(secret, token, paymentArgsHash(altered), 1000)).toEqual({
      ok: false,
      reason: 'forged',
    });
  });

  it('is forged under another secret or with edited claims', () => {
    expect(verifyCapability('other', token, paymentArgsHash(args), 1000).ok).toBe(false);
    const later = Buffer.from(JSON.stringify({ ...claims, exp: 9999 })).toString('base64url');
    const edited = `${later}.${token.split('.')[1]}`;
    expect(verifyCapability(secret, edited, paymentArgsHash(args), 1000)).toEqual({
      ok: false,
      reason: 'forged',
    });
  });

  it('expires', () => {
    expect(verifyCapability(secret, token, paymentArgsHash(args), 2000)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects junk', () => {
    for (const junk of ['', 'spike', 'a.b.c', '!!.??']) {
      expect(verifyCapability(secret, junk, paymentArgsHash(args), 1000).ok).toBe(false);
    }
  });
});
