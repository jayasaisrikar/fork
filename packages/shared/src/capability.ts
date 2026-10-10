import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashCanonical } from './hash';

export interface CapabilityClaims {
  runId: string;
  stepIndex: number;
  // unix seconds
  exp: number;
}

export interface PaymentArgs {
  scenarioId: string;
  vendorId: string;
  recipientId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
}

// the exact payment a capability is good for. change any field and the hash changes.
export function paymentArgsHash(args: PaymentArgs): string {
  const { scenarioId, vendorId, recipientId, amountCents, currency, idempotencyKey } = args;
  return hashCanonical({
    scenarioId,
    vendorId,
    recipientId,
    amountCents,
    currency,
    idempotencyKey,
  });
}

function sign(secret: string, claims: CapabilityClaims, argsHash: string): string {
  const message = `${claims.runId}|${claims.stepIndex}|${argsHash}|${claims.exp}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

export function mintCapability(secret: string, claims: CapabilityClaims, argsHash: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(secret, claims, argsHash)}`;
}

export type CapabilityCheck =
  | { ok: true; id: string; claims: CapabilityClaims }
  | { ok: false; reason: 'malformed' | 'forged' | 'expired' };

export function verifyCapability(
  secret: string,
  token: string,
  argsHash: string,
  nowSeconds: number,
): CapabilityCheck {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length) return { ok: false, reason: 'malformed' };

  let claims: CapabilityClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof claims?.runId !== 'string' ||
    !Number.isInteger(claims.stepIndex) ||
    !Number.isInteger(claims.exp)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = Buffer.from(sign(secret, claims, argsHash));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'forged' };
  }
  if (claims.exp <= nowSeconds) return { ok: false, reason: 'expired' };

  // the signature is unique per run, step and args, so it doubles as the single-use id
  return { ok: true, id: signature, claims };
}
