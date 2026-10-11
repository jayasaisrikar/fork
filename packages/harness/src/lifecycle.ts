export type BranchStatus =
  | 'PROPOSED'
  | 'SIMULATED'
  | 'APPROVED'
  | 'COMMITTING'
  | 'COMMITTED'
  | 'PARTIALLY_COMMITTED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'INFEASIBLE'
  | 'STALE';

export type StepStatus =
  | 'PENDING'
  | 'AUTHORIZING'
  | 'ALLOWED'
  | 'HELD'
  | 'DENIED'
  | 'FAILED'
  | 'EXECUTED'
  | 'NOT_EXECUTED';

// exported so the lab page draws the lifecycle from the table the guards use
export const BRANCH_NEXT: Record<BranchStatus, BranchStatus[]> = {
  PROPOSED: ['SIMULATED', 'INFEASIBLE', 'STALE'],
  SIMULATED: ['APPROVED', 'INFEASIBLE', 'STALE'],
  APPROVED: ['COMMITTING', 'STALE', 'CANCELLED'],
  COMMITTING: ['COMMITTED', 'PARTIALLY_COMMITTED', 'BLOCKED', 'CANCELLED'],
  COMMITTED: [],
  PARTIALLY_COMMITTED: [],
  BLOCKED: [],
  CANCELLED: [],
  INFEASIBLE: [],
  STALE: [],
};

const STEP_NEXT: Record<StepStatus, StepStatus[]> = {
  PENDING: ['AUTHORIZING', 'NOT_EXECUTED'],
  // back to itself when a crashed run is picked up again
  AUTHORIZING: ['AUTHORIZING', 'ALLOWED', 'HELD', 'DENIED', 'FAILED'],
  // a hold is not an approval. it only becomes one when ArmorIQ says so.
  HELD: ['AUTHORIZING', 'ALLOWED', 'DENIED', 'NOT_EXECUTED'],
  ALLOWED: ['EXECUTED', 'NOT_EXECUTED'],
  DENIED: ['NOT_EXECUTED'],
  FAILED: ['NOT_EXECUTED'],
  EXECUTED: [],
  NOT_EXECUTED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly kind: 'branch' | 'step',
    readonly from: string,
    readonly to: string,
  ) {
    super(`A ${kind} cannot go from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertBranchTransition(from: BranchStatus, to: BranchStatus) {
  if (!BRANCH_NEXT[from].includes(to)) throw new InvalidTransitionError('branch', from, to);
}

export function assertStepTransition(from: StepStatus, to: StepStatus) {
  if (!STEP_NEXT[from].includes(to)) throw new InvalidTransitionError('step', from, to);
}

export const isFinalStep = (status: StepStatus) => STEP_NEXT[status].length === 0;
export const isFinalBranch = (status: BranchStatus) => BRANCH_NEXT[status].length === 0;
