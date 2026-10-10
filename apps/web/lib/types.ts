export interface Vendor {
  id: string;
  name: string;
  recipientId: string;
  approved: boolean;
}

export interface Invoice {
  id: string;
  vendorId: string;
  amountCents: number;
  paidCents: number;
  dueDate: string;
  criticality: 'critical' | 'important' | 'deferrable';
  note?: string;
}

export interface Scenario {
  scenarioId: string;
  today: string;
  cashCents: number;
  reserveCents: number;
  holdAboveCents: number;
  vendors: Vendor[];
  invoices: Invoice[];
}

export interface InvoiceLine {
  invoiceId: string;
  vendorId: string;
  paidCents: number;
  remainingCents: number;
  lateFeeCents: number;
}

export interface Projection {
  outflowCents: number;
  cashAfterCents: number;
  lowestCashCents: number;
  reserveBreached: boolean;
  deferredCents: number;
  lateFeesCents: number;
  lines: InvoiceLine[];
  cashPath: { date: string; cashCents: number }[];
}

export interface Risk {
  reserveBreach: boolean;
  criticalDeferred: string[];
  lateFeeExposureCents: number;
  vendorsWithBalance: string[];
  approvalsNeeded: number;
}

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

export interface Branch {
  id: string;
  runId: number;
  parentId: string | null;
  label: string;
  title: string;
  rationale: string;
  source: 'agent' | 'fixture' | 'replan';
  baseSnapshotHash: string;
  actions: { invoiceId: string; payCents: number }[];
  projection: Projection | null;
  feasibility: { ok: boolean; reasons: string[] } | null;
  risk: Risk | null;
  approvedPlanHash: string | null;
  status: BranchStatus;
}

export interface PlannedAction {
  branchId: string;
  stepIndex: number;
  tool: string;
  kind: 'read' | 'write';
  args: Record<string, string | number>;
}

export interface Approval {
  branchId: string;
  approvedPlanHash: string;
  actor: string;
  at: string;
  revokedAt: string | null;
}

export interface Execution {
  id: string;
  branchId: string;
  kind: 'commit' | 'tamper_test';
  approvedPlanHash: string;
  armorPlanId: string;
  armorPlanHash: string;
  merkleRoot: string;
  tokenId: string;
  expiresAt: string;
  status: 'RUNNING' | 'DONE';
}

export interface Step {
  id: number;
  executionId: string;
  branchId: string;
  stepIndex: number | null;
  origin: 'runner' | 'tamper_test' | 'agent';
  tool: string;
  kind: 'read' | 'write';
  args: Record<string, unknown>;
  verdict: string | null;
  source: 'armoriq' | 'fork' | 'mcp' | null;
  errorClass: string | null;
  message: string | null;
  delegationId: string | null;
  receiptId: string | null;
  latencyMs: number | null;
  status: string;
  at: string;
}

export interface Message {
  id: string;
  from: string;
  subject: string;
  body: string;
  receivedAt: string;
}

export interface RunView {
  run: { id: number; createdAt: string; actor: string };
  snapshot: { hash: string; state: Scenario };
  branches: Branch[];
  actions: PlannedAction[];
  approvals: Approval[];
  executions: Execution[];
  steps: Step[];
  messages: Message[];
}

export interface AuditEvent {
  id: number;
  runId: number | null;
  at: string;
  actor: string;
  source: 'agent' | 'fork' | 'armoriq' | 'mcp' | 'ledger' | 'human';
  type: string;
  refs: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface Health {
  db: boolean;
  mcpReachable: boolean;
  armoriqConfigured: boolean;
  armoriqReachable: boolean;
  armoriqVerified: { at: string; verdict: string } | null;
  registeredTools: string[];
  reason?: string;
}
