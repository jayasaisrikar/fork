import type { CanonicalToolStep } from './plan';

export interface Feasibility {
  ok: boolean;
  reasons: string[];
}

export interface VerificationResult {
  ok: boolean;
  problems: string[];
}

// everything FORK needs to know about a domain. treasury is the first one.
export interface ForkDomainAdapter<Base, Action, Projection, Diff, Receipt> {
  validateActions(base: Base, input: unknown): Action[];
  simulate(base: Base, actions: Action[]): Projection;
  diff(base: Base, projected: Projection): Diff;
  feasibility(base: Base, projection: Projection): Feasibility;
  toToolSteps(base: Base, actions: Action[], idempotencyPrefix: string): CanonicalToolStep[];
  verifyPostcondition(before: Base, after: Base, receipts: Receipt[]): VerificationResult;
}
