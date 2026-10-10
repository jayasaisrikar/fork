import { hashCanonical } from '@fork/shared/hash';

// one MCP call exactly as it will be signed. args hold whole numbers and strings only.
export interface CanonicalToolStep {
  tool: string;
  kind: 'read' | 'write';
  args: Record<string, string | number>;
}

export interface ApprovalSubject {
  branchId: string;
  version: number;
  baseSnapshotHash: string;
  steps: CanonicalToolStep[];
  currency: string;
  actorId: string;
}

// what the CFO actually approved. any change to a step, its order or the base gives a new hash.
export function approvedPlanHash(subject: ApprovalSubject): string {
  const { branchId, version, baseSnapshotHash, steps, currency, actorId } = subject;
  return hashCanonical({ branchId, version, baseSnapshotHash, steps, currency, actorId });
}
