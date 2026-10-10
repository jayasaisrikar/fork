import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { DispatchResult, Gateway, PlanStep, SignedPlan } from '@fork/armor-adapter';
import { cashCents, loadState, schema, type Db } from '@fork/db';
import {
  AllocationError,
  annotate,
  BranchProposalSchema,
  financeAdapter,
  type Allocation,
  type TreasuryState,
} from '@fork/domain-finance';
import {
  approvedPlanHash,
  assertBranchTransition,
  assertStepTransition,
  InvalidTransitionError,
  runSteps,
  type BranchStatus,
  type CanonicalToolStep,
  type StepResult,
  type StepStatus,
} from '@fork/harness';
import { LARGE_PAYMENT_TOOL } from '@fork/shared';
import { mintCapability, paymentArgsHash, type PaymentArgs } from '@fork/shared/capability';
import { hashCanonical } from '@fork/shared/hash';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';

const {
  approvals,
  auditEvents,
  branchActions,
  branches,
  executions,
  executionSteps,
  runs,
  snapshots,
} = schema;

export type Branch = typeof branches.$inferSelect;
export type Execution = typeof executions.$inferSelect;
export type ExecutionStep = typeof executionSteps.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
type AuditSource = AuditEvent['source'];

// FORK's own refusals get their own value so they are never mistaken for an ArmorIQ verdict
export const REJECTED_BY_FORK = 'rejected_by_fork';
const TOKEN_SECONDS = 1800;
const ATTACKER_RECIPIENT = 'recipient-external-999';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 503,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface InboxContext {
  runId: number;
  branchId: string;
  executionId: string;
  messages: unknown[];
}

export interface EngineDeps {
  db: Db;
  // null when ArmorIQ is not configured. commit stays off and says why.
  gateway: Gateway | null;
  gatewayMissingReason?: string;
  capabilitySecret: string;
  holdTimeoutMs?: number;
  now?: () => Date;
  onInboxMessages?: (context: InboxContext) => Promise<void>;
}

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(deps: EngineDeps) {
  const { db, capabilitySecret } = deps;
  const now = deps.now ?? (() => new Date());
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const cancelRequests = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();

  function audit(
    runId: number | null,
    source: AuditSource,
    type: string,
    actor: string,
    refs: Record<string, unknown> = {},
    payload: Record<string, unknown> = {},
  ) {
    const row = db
      .insert(auditEvents)
      .values({ runId, at: now().toISOString(), actor, source, type, refs, payload })
      .returning()
      .get();
    events.emit('audit', row);
    return row;
  }

  function branchOrThrow(branchId: string): Branch {
    const branch = db.select().from(branches).where(eq(branches.id, branchId)).get();
    if (!branch) throw new ApiError('NOT_FOUND', 404, `No branch ${branchId}`);
    return branch;
  }

  function snapshotState(branch: Branch): TreasuryState {
    const snapshot = db
      .select()
      .from(snapshots)
      .where(eq(snapshots.hash, branch.baseSnapshotHash))
      .get();
    if (!snapshot)
      throw new ApiError('NOT_FOUND', 404, 'The base snapshot for this branch is missing');
    return snapshot.state as TreasuryState;
  }

  function currentState(scenarioId: string): TreasuryState {
    const state = loadState(db, scenarioId);
    if (!state) throw new ApiError('NOT_FOUND', 404, `No scenario ${scenarioId}`);
    return state;
  }

  // every status change goes through the guard
  function moveBranch(branch: Branch, to: BranchStatus, actor = 'fork') {
    const row = db
      .select({ status: branches.status })
      .from(branches)
      .where(eq(branches.id, branch.id))
      .get();
    assertBranchTransition((row?.status ?? branch.status) as BranchStatus, to);
    db.update(branches).set({ status: to }).where(eq(branches.id, branch.id)).run();
    audit(branch.runId, 'fork', `branch.${to.toLowerCase()}`, actor, { branchId: branch.id });
  }

  // a refused transition is a security event. logged out here so a rolled-back transaction cannot lose it.
  function guarded<Args extends unknown[], Result>(name: string, fn: (...args: Args) => Result) {
    const report = (error: unknown) => {
      if (error instanceof InvalidTransitionError) {
        audit(
          null,
          'fork',
          'security.invalid_transition',
          'fork',
          { operation: name },
          { kind: error.kind, from: error.from, to: error.to },
        );
      }
      throw error;
    };
    return (...args: Args): Result => {
      try {
        const result = fn(...args);
        return (result instanceof Promise ? result.catch(report) : result) as Result;
      } catch (error) {
        return report(error);
      }
    };
  }

  function moveStep(
    step: ExecutionStep,
    to: StepStatus,
    patch: Partial<ExecutionStep> = {},
  ): ExecutionStep {
    assertStepTransition(step.status as StepStatus, to);
    return db
      .update(executionSteps)
      .set({ ...patch, status: to, at: now().toISOString() })
      .where(eq(executionSteps.id, step.id))
      .returning()
      .get();
  }

  function createRun(actor: string, scenarioId = 'liquidity-shortfall') {
    const state = currentState(scenarioId);
    const hash = hashCanonical(state);
    const at = now().toISOString();
    const existing = db.select().from(snapshots).where(eq(snapshots.hash, hash)).get();
    const snapshot =
      existing ??
      db
        .insert(snapshots)
        .values({ id: randomUUID(), scenarioId, hash, state, createdAt: at })
        .returning()
        .get();
    const run = db
      .insert(runs)
      .values({ domain: 'finance', scenarioId, baseSnapshotId: snapshot.id, actor, createdAt: at })
      .returning()
      .get();
    audit(run.id, 'human', 'run.created', actor, { snapshotHash: hash });
    return run;
  }

  function runOrThrow(runId: number) {
    const run = db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) throw new ApiError('NOT_FOUND', 404, `No run ${runId}`);
    return run;
  }

  function getRun(runId: number) {
    const run = runOrThrow(runId);
    const snapshot = db.select().from(snapshots).where(eq(snapshots.id, run.baseSnapshotId)).get();
    return {
      run,
      snapshot,
      branches: db
        .select()
        .from(branches)
        .where(eq(branches.runId, runId))
        .orderBy(asc(branches.createdAt), asc(branches.label))
        .all(),
      // capabilities are secrets, they never leave the engine
      actions: db
        .select({
          branchId: branchActions.branchId,
          stepIndex: branchActions.stepIndex,
          tool: branchActions.tool,
          kind: branchActions.kind,
          args: branchActions.args,
        })
        .from(branchActions)
        .innerJoin(branches, eq(branches.id, branchActions.branchId))
        .where(eq(branches.runId, runId))
        .orderBy(asc(branchActions.stepIndex))
        .all(),
      approvals: db
        .select({
          branchId: approvals.branchId,
          approvedPlanHash: approvals.approvedPlanHash,
          actor: approvals.actor,
          at: approvals.at,
          revokedAt: approvals.revokedAt,
        })
        .from(approvals)
        .innerJoin(branches, eq(branches.id, approvals.branchId))
        .where(eq(branches.runId, runId))
        .all(),
      executions: db
        .select()
        .from(executions)
        .where(eq(executions.runId, runId))
        .orderBy(asc(executions.createdAt))
        .all(),
      steps: db
        .select()
        .from(executionSteps)
        .where(eq(executionSteps.runId, runId))
        .orderBy(asc(executionSteps.id))
        .all(),
    };
  }

  // proposals are untrusted input, whoever wrote them
  function addBranches(
    runId: number,
    proposal: unknown,
    source: Branch['source'],
    parent?: Branch,
  ) {
    const run = runOrThrow(runId);
    const snapshot = db.select().from(snapshots).where(eq(snapshots.id, run.baseSnapshotId)).get();
    if (!snapshot) throw new ApiError('NOT_FOUND', 404, 'The run has no base snapshot');
    const state = snapshot.state as TreasuryState;

    const parsed = BranchProposalSchema.safeParse(proposal);
    if (!parsed.success) {
      throw new ApiError(
        'INVALID_PROPOSAL',
        422,
        'The proposal does not match the schema',
        parsed.error.issues,
      );
    }

    const existing = db.select().from(branches).where(eq(branches.runId, runId)).all().length;
    const created: Branch[] = [];
    parsed.data.branches.forEach((item, i) => {
      let actions: Allocation[];
      try {
        actions = financeAdapter.validateActions(state, item.allocations);
      } catch (error) {
        if (error instanceof AllocationError) {
          throw new ApiError(
            'INVALID_PROPOSAL',
            422,
            `"${item.title}" was rejected`,
            error.reasons,
          );
        }
        throw error;
      }
      const label = parent ? `${parent.label}′` : String.fromCharCode(65 + existing + i);
      const branch = db
        .insert(branches)
        .values({
          id: randomUUID(),
          runId,
          parentId: parent?.id,
          version: 1,
          label,
          title: item.title,
          rationale: item.rationale,
          source,
          baseSnapshotHash: snapshot.hash,
          actions,
          status: 'PROPOSED',
          createdAt: now().toISOString(),
        })
        .returning()
        .get();
      audit(
        runId,
        source === 'fixture' ? 'fork' : 'agent',
        'branch.proposed',
        source,
        { branchId: branch.id },
        { label, title: item.title },
      );
      created.push(branch);
    });
    return created;
  }

  function simulateBranch(branchId: string) {
    const branch = branchOrThrow(branchId);
    const state = snapshotState(branch);
    const projection = financeAdapter.simulate(state, branch.actions as Allocation[]);
    const feasibility = financeAdapter.feasibility(state, projection);
    const risk = annotate(state, projection);

    db.update(branches)
      .set({ projection, feasibility, risk })
      .where(eq(branches.id, branch.id))
      .run();
    moveBranch(branch, feasibility.ok ? 'SIMULATED' : 'INFEASIBLE');
    if (!feasibility.ok) {
      audit(
        branch.runId,
        'fork',
        'branch.rejected_by_fork',
        'fork',
        { branchId },
        { verdict: REJECTED_BY_FORK, reasons: feasibility.reasons },
      );
    }
    return branchOrThrow(branchId);
  }

  const isStale = (branch: Branch, scenarioId: string) =>
    hashCanonical(currentState(scenarioId)) !== branch.baseSnapshotHash;

  function storedSteps(branchId: string) {
    return db
      .select()
      .from(branchActions)
      .where(eq(branchActions.branchId, branchId))
      .orderBy(asc(branchActions.stepIndex))
      .all();
  }

  // the stored steps must still hash to what the CFO approved, and the approval must still stand
  function approvalProblem(branch: Branch): string | undefined {
    const approval = db
      .select()
      .from(approvals)
      .where(and(eq(approvals.branchId, branch.id), isNull(approvals.revokedAt)))
      .orderBy(desc(approvals.id))
      .get();
    if (!approval || !branch.approvedPlanHash) return 'This branch has no standing approval';
    if (approval.approvedPlanHash !== branch.approvedPlanHash)
      return 'The approval is for a different plan';

    const steps: CanonicalToolStep[] = storedSteps(branch.id).map(({ tool, kind, args }) => ({
      tool,
      kind,
      args,
    }));
    const hash = approvedPlanHash({
      branchId: branch.id,
      version: branch.version,
      baseSnapshotHash: branch.baseSnapshotHash,
      steps,
      currency: 'USD',
      actorId: approval.actor,
    });
    return hash === branch.approvedPlanHash
      ? undefined
      : 'The stored steps no longer match the approved plan';
  }

  function authorizeBranch(branchId: string, actor: string) {
    const branch = branchOrThrow(branchId);
    const run = runOrThrow(branch.runId);
    if (branch.status === 'SIMULATED' && isStale(branch, run.scenarioId)) {
      moveBranch(branch, 'STALE', actor);
      throw new ApiError(
        'STALE',
        409,
        'The books changed since this branch was simulated. Start a new run.',
      );
    }

    const state = snapshotState(branch);
    const steps = financeAdapter.toToolSteps(
      state,
      branch.actions as Allocation[],
      `${branch.id}:v${branch.version}`,
    );
    const hash = approvedPlanHash({
      branchId: branch.id,
      version: branch.version,
      baseSnapshotHash: branch.baseSnapshotHash,
      steps,
      currency: state.currency,
      actorId: actor,
    });
    const at = now();
    const exp = Math.floor(at.getTime() / 1000) + TOKEN_SECONDS;

    db.transaction(
      () => {
        moveBranch(branch, 'APPROVED', actor);
        db.update(branches).set({ approvedPlanHash: hash }).where(eq(branches.id, branch.id)).run();
        db.insert(branchActions)
          .values(
            steps.map((step, stepIndex) => ({
              branchId: branch.id,
              stepIndex,
              tool: step.tool,
              kind: step.kind,
              args: step.args,
              // one single-use capability per write, bound to these exact args
              capability:
                step.kind === 'write'
                  ? mintCapability(
                      capabilitySecret,
                      { runId: String(run.id), stepIndex, exp },
                      paymentArgsHash(step.args as unknown as PaymentArgs),
                    )
                  : null,
            })),
          )
          .run();
        db.insert(approvals)
          .values({ branchId: branch.id, approvedPlanHash: hash, actor, at: at.toISOString() })
          .run();
      },
      { behavior: 'immediate' },
    );
    audit(
      run.id,
      'human',
      'branch.authorized',
      actor,
      { branchId, approvedPlanHash: hash },
      { steps: steps.length },
    );
    return { branch: branchOrThrow(branchId), approvedPlanHash: hash, steps };
  }

  function planSteps(branchId: string): { action: PlanStep; kind: 'read' | 'write' }[] {
    return storedSteps(branchId).map((row) => ({
      kind: row.kind,
      action: {
        action: row.tool,
        params:
          row.kind === 'write'
            ? {
                ...row.args,
                amount: Number(row.args.amountCents) / 100,
                approvedExecutionRef: row.capability,
              }
            : row.args,
      },
    }));
  }

  async function sign(branch: Branch, goal: string): Promise<SignedPlan> {
    if (!deps.gateway) {
      throw new ApiError(
        'ARMORIQ_NOT_CONFIGURED',
        503,
        deps.gatewayMissingReason ?? 'ArmorIQ is not configured. Nothing can be committed.',
      );
    }
    try {
      return await deps.gateway.sign(
        goal,
        planSteps(branch.id).map((step) => step.action),
        TOKEN_SECONDS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit(
        branch.runId,
        'armoriq',
        'armoriq.unavailable',
        'fork',
        { branchId: branch.id },
        { message },
      );
      throw new ApiError(
        'ARMORIQ_UNAVAILABLE',
        503,
        "ArmorIQ didn't respond. Nothing was paid. Commit is paused.",
        { message },
      );
    }
  }

  function newExecution(branch: Branch, kind: Execution['kind'], plan: SignedPlan): Execution {
    return db
      .insert(executions)
      .values({
        id: randomUUID(),
        runId: branch.runId,
        branchId: branch.id,
        kind,
        approvedPlanHash: branch.approvedPlanHash ?? '',
        armorPlanId: plan.planId,
        armorPlanHash: plan.planHash,
        merkleRoot: plan.merkleRoot,
        tokenId: plan.tokenId,
        expiresAt: plan.expiresAt,
        status: 'RUNNING',
        createdAt: now().toISOString(),
      })
      .returning()
      .get();
  }

  // never keep the capability in a step row
  const loggable = (params: Record<string, unknown>) => ({
    ...params,
    approvedExecutionRef: undefined,
  });

  async function commitBranch(branchId: string, actor: string) {
    let branch = branchOrThrow(branchId);
    const run = runOrThrow(branch.runId);
    if (branch.status !== 'APPROVED')
      throw new InvalidTransitionError('branch', branch.status, 'COMMITTING');
    const problem = approvalProblem(branch);
    if (problem) {
      audit(
        run.id,
        'fork',
        'security.approval_check_failed',
        actor,
        { branchId },
        { verdict: REJECTED_BY_FORK, problem },
      );
      throw new ApiError('APPROVAL_INVALID', 409, problem);
    }
    if (isStale(branch, run.scenarioId)) {
      moveBranch(branch, 'STALE', actor);
      throw new ApiError(
        'STALE',
        409,
        'The books changed since this branch was authorized. Start a new run.',
      );
    }

    const plan = await sign(branch, `${branch.title}. ${branch.rationale}`);

    let execution: Execution;
    try {
      // whoever gets here first owns the commit. a second caller fails the transition.
      execution = db.transaction(
        () => {
          branch = branchOrThrow(branchId);
          moveBranch(branch, 'COMMITTING', actor);
          const created = newExecution(branch, 'commit', plan);
          db.insert(executionSteps)
            .values(
              planSteps(branchId).map((step, stepIndex) => ({
                executionId: created.id,
                runId: run.id,
                branchId,
                stepIndex,
                origin: 'runner' as const,
                tool: step.action.action,
                kind: step.kind,
                args: loggable(step.action.params),
                requestedArgsHash: hashCanonical(storedSteps(branchId)[stepIndex]?.args ?? {}),
                status: 'PENDING',
                at: now().toISOString(),
              })),
            )
            .run();
          return created;
        },
        { behavior: 'immediate' },
      );
    } catch (error) {
      await deps.gateway?.close(plan.planId, 'failed').catch(() => undefined);
      throw error;
    }

    audit(
      run.id,
      'armoriq',
      'plan.signed',
      actor,
      { branchId, executionId: execution.id, planId: plan.planId },
      { ...plan },
    );
    track(execution.id, runExecution(execution, plan.planId));
    return execution;
  }

  function track(executionId: string, work: Promise<void>) {
    const guarded = work
      .catch((error) => {
        console.error('commit runner crashed', error);
        audit(
          null,
          'fork',
          'runner.crashed',
          'fork',
          { executionId },
          { message: error instanceof Error ? error.message : String(error) },
        );
      })
      .finally(() => inFlight.delete(executionId));
    inFlight.set(executionId, guarded);
  }

  function recordDecision(
    step: ExecutionStep,
    decision: DispatchResult,
  ): { step: ExecutionStep; result: StepResult } {
    const common = {
      verdict: decision.verdict,
      latencyMs: decision.latencyMs,
      delegationId: decision.delegationId ?? step.delegationId,
    };
    // the row may have moved to HELD while we waited
    const current =
      db.select().from(executionSteps).where(eq(executionSteps.id, step.id)).get() ?? step;

    if (decision.verdict === 'allow' && !decision.toolError) {
      const allowed = moveStep(current, 'ALLOWED', { ...common, source: 'armoriq' });
      return {
        step: moveStep(allowed, 'EXECUTED', { receiptId: receiptIdOf(decision.result) }),
        result: { status: 'EXECUTED' },
      };
    }
    if (decision.verdict === 'allow') {
      // ArmorIQ said yes, the MCP said no. that refusal is ours, not ArmorIQ's.
      const allowed = moveStep(current, 'ALLOWED', common);
      const patch = {
        source: 'mcp' as const,
        errorClass: decision.toolError?.code,
        message: decision.toolError?.message,
      };
      return { step: moveStep(allowed, 'NOT_EXECUTED', patch), result: { status: 'FAILED' } };
    }

    const patch = {
      ...common,
      source: 'armoriq' as const,
      errorClass: decision.errorClass,
      message: decision.message,
    };
    if (decision.verdict === 'hold') {
      const held = current.status === 'HELD' ? current : moveStep(current, 'HELD', patch);
      return { step: moveStep(held, 'NOT_EXECUTED', patch), result: { status: 'NOT_EXECUTED' } };
    }
    const refused = moveStep(current, decision.verdict === 'block' ? 'DENIED' : 'FAILED', patch);
    return {
      step: moveStep(refused, 'NOT_EXECUTED'),
      result: { status: decision.verdict === 'block' ? 'DENIED' : 'FAILED' },
    };
  }

  function stepAudit(step: ExecutionStep, actor = 'fork') {
    const source: AuditSource = step.source ?? 'fork';
    audit(
      step.runId,
      source,
      `step.${step.status.toLowerCase()}`,
      actor,
      {
        branchId: step.branchId,
        executionId: step.executionId,
        stepId: step.id,
        stepIndex: step.stepIndex,
        receiptId: step.receiptId,
        delegationId: step.delegationId,
      },
      {
        tool: step.tool,
        origin: step.origin,
        verdict: step.verdict,
        errorClass: step.errorClass,
        message: step.message,
        args: step.args,
      },
    );
  }

  async function runExecution(execution: Execution, planId: string) {
    const gateway = deps.gateway;
    if (!gateway) throw new Error('commit started without a gateway');
    const branch = branchOrThrow(execution.branchId);
    const run = runOrThrow(execution.runId);
    const plan = planSteps(branch.id);
    const rows = () =>
      db
        .select()
        .from(executionSteps)
        .where(
          and(eq(executionSteps.executionId, execution.id), eq(executionSteps.origin, 'runner')),
        )
        .orderBy(asc(executionSteps.stepIndex))
        .all();

    const summary = await runSteps<ExecutionStep>({
      steps: rows(),
      isWrite: (step) => step.kind === 'write',
      alreadyDone(step) {
        const fresh = rows().find((row) => row.id === step.id) ?? step;
        if (fresh.status === 'EXECUTED') return { status: 'EXECUTED' };
        if (fresh.status !== 'NOT_EXECUTED') return undefined;
        return fresh.verdict === 'hold' ? { status: 'NOT_EXECUTED' } : { status: 'DENIED' };
      },
      cancelled: () => cancelRequests.has(branch.id),
      skip(step, reason) {
        const message =
          reason === 'cancelled'
            ? 'Cancelled before this step ran'
            : 'Not run because an earlier step was refused';
        stepAudit(moveStep(step, 'NOT_EXECUTED', { message }));
      },
      async execute(step) {
        const fresh = rows().find((row) => row.id === step.id) ?? step;
        let current = moveStep(fresh, 'AUTHORIZING');
        const planned = plan[step.stepIndex ?? -1];
        if (!planned) throw new Error(`step ${step.stepIndex} is not in the approved plan`);

        if (step.kind === 'write') {
          // FORK's own gate, checked again right before money would move
          const problem =
            approvalProblem(branchOrThrow(branch.id)) ??
            (cashCents(db, run.scenarioId) < Number(planned.action.params.amountCents)
              ? 'Not enough cash for this payment'
              : undefined);
          if (problem) {
            const denied = moveStep(current, 'DENIED', {
              verdict: REJECTED_BY_FORK,
              source: 'fork',
              message: problem,
            });
            stepAudit(moveStep(denied, 'NOT_EXECUTED'));
            return { status: 'DENIED' };
          }
        }

        const decision = await gateway.dispatch(planId, planned.action, {
          waitForApproval: step.tool === LARGE_PAYMENT_TOOL,
          holdTimeoutMs: deps.holdTimeoutMs,
          onHold(hold) {
            if (current.status === 'AUTHORIZING')
              current = moveStep(current, 'HELD', { source: 'armoriq' });
            if (hold.delegationId && current.delegationId !== hold.delegationId) {
              current = db
                .update(executionSteps)
                .set({ delegationId: hold.delegationId })
                .where(eq(executionSteps.id, current.id))
                .returning()
                .get();
              stepAudit(current);
            }
          },
        });
        const recorded = recordDecision(current, decision);
        stepAudit(recorded.step);

        if (step.tool === 'get_sandbox_messages' && recorded.result.status === 'EXECUTED') {
          const messages = inboxOf(decision.result);
          if (messages.length && deps.onInboxMessages) {
            await deps
              .onInboxMessages({
                runId: run.id,
                branchId: branch.id,
                executionId: execution.id,
                messages,
              })
              .catch((error) => console.error('inbox agent failed', error));
          }
        }
        return recorded.result;
      },
    });

    cancelRequests.delete(branch.id);
    moveBranch(branchOrThrow(branch.id), summary.final);
    db.update(executions).set({ status: 'DONE' }).where(eq(executions.id, execution.id)).run();

    const paid = db
      .select()
      .from(schema.receipts)
      .all()
      .filter((receipt) => rows().some((row) => row.receiptId === receipt.id));
    const check = financeAdapter.verifyPostcondition(
      snapshotState(branch),
      currentState(run.scenarioId),
      paid,
    );
    audit(
      run.id,
      'ledger',
      check.ok ? 'ledger.reconciled' : 'ledger.mismatch',
      'fork',
      { branchId: branch.id, executionId: execution.id },
      { ...check, ...summary },
    );

    await gateway
      .close(planId, summary.final === 'COMMITTED' ? 'completed' : 'failed')
      .catch((error) => {
        audit(
          run.id,
          'armoriq',
          'plan.close_failed',
          'fork',
          { planId },
          { message: error instanceof Error ? error.message : String(error) },
        );
      });
  }

  function cancelBranch(branchId: string, actor: string) {
    const branch = branchOrThrow(branchId);
    if (branch.status === 'COMMITTING') {
      cancelRequests.add(branchId);
      audit(branch.runId, 'human', 'branch.cancel_requested', actor, { branchId });
    } else {
      moveBranch(branch, 'CANCELLED', actor);
      db.update(approvals)
        .set({ revokedAt: now().toISOString() })
        .where(eq(approvals.branchId, branchId))
        .run();
    }
    return branchOrThrow(branchId);
  }

  // picks up commits that were mid-run when the process died. the approved plan has not changed,
  // so a fresh token for the same steps is fine, and idempotency keys stop any double payment.
  async function resumeInFlight() {
    const stuck = db.select().from(branches).where(eq(branches.status, 'COMMITTING')).all();
    for (const branch of stuck) {
      const execution = db
        .select()
        .from(executions)
        .where(
          and(
            eq(executions.branchId, branch.id),
            eq(executions.kind, 'commit'),
            eq(executions.status, 'RUNNING'),
          ),
        )
        .get();
      if (!execution || inFlight.has(execution.id)) continue;
      if (approvalProblem(branch)) {
        moveBranch(branch, 'BLOCKED');
        continue;
      }
      const plan = await sign(branch, `${branch.title}. ${branch.rationale}`);
      db.update(executions)
        .set({
          armorPlanId: plan.planId,
          armorPlanHash: plan.planHash,
          merkleRoot: plan.merkleRoot,
          tokenId: plan.tokenId,
          expiresAt: plan.expiresAt,
        })
        .where(eq(executions.id, execution.id))
        .run();
      audit(branch.runId, 'armoriq', 'plan.resigned', 'fork', {
        branchId: branch.id,
        executionId: execution.id,
        planId: plan.planId,
      });
      track(execution.id, runExecution(execution, plan.planId));
    }
  }

  // a deliberate, labeled security test. it signs the approved steps again and then tries two
  // things the plan never allowed, through the real ArmorIQ path.
  async function tamperTest(branchId: string, actor: string) {
    const gateway = deps.gateway;
    const branch = branchOrThrow(branchId);
    if (!branch.approvedPlanHash)
      throw new ApiError(
        'NOT_AUTHORIZED',
        409,
        'Authorize a branch before running the tamper test',
      );
    const firstPayment = storedSteps(branchId).find((row) => row.kind === 'write');
    if (!firstPayment)
      throw new ApiError('NO_PAYMENTS', 409, 'This branch has no payment to tamper with');

    const plan = await sign(
      branch,
      `Tamper test for branch ${branch.label} (deliberate security test)`,
    );
    if (!gateway) throw new Error('unreachable');
    const execution = newExecution(branch, 'tamper_test', plan);
    audit(branch.runId, 'human', 'tamper_test.started', actor, {
      branchId,
      executionId: execution.id,
      planId: plan.planId,
    });

    const altered = {
      ...firstPayment.args,
      recipientId: ATTACKER_RECIPIENT,
      amount: Number(firstPayment.args.amountCents) / 100,
      approvedExecutionRef: firstPayment.capability,
    };
    const attempts: { step: PlanStep; kind: 'read' | 'write' }[] = [
      {
        kind: 'write',
        step: {
          action: 'update_vendor_destination',
          params: { vendorId: firstPayment.args.vendorId, recipientId: ATTACKER_RECIPIENT },
        },
      },
      { kind: 'write', step: { action: firstPayment.tool, params: altered } },
    ];

    const results: ExecutionStep[] = [];
    for (const attempt of attempts) {
      const row = db
        .insert(executionSteps)
        .values({
          executionId: execution.id,
          runId: branch.runId,
          branchId,
          stepIndex: null,
          origin: 'tamper_test',
          tool: attempt.step.action,
          kind: attempt.kind,
          args: loggable(attempt.step.params),
          requestedArgsHash: hashCanonical({
            ...attempt.step.params,
            amount: undefined,
            approvedExecutionRef: undefined,
          }),
          status: 'PENDING',
          at: now().toISOString(),
        })
        .returning()
        .get();
      const decision = await gateway.dispatch(plan.planId, attempt.step);
      const recorded = recordDecision(moveStep(row, 'AUTHORIZING'), decision);
      stepAudit(recorded.step, actor);
      results.push(recorded.step);
    }

    db.update(executions).set({ status: 'DONE' }).where(eq(executions.id, execution.id)).run();
    await gateway.close(plan.planId, 'failed').catch(() => undefined);
    return { execution, steps: results };
  }

  function timeline(runId: number, afterId = 0): AuditEvent[] {
    return db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.runId, runId), gt(auditEvents.id, afterId)))
      .orderBy(asc(auditEvents.id))
      .all();
  }

  return {
    events,
    audit,
    createRun,
    getRun,
    addBranches,
    simulateBranch: guarded('simulateBranch', simulateBranch),
    authorizeBranch: guarded('authorizeBranch', authorizeBranch),
    commitBranch: guarded('commitBranch', commitBranch),
    cancelBranch: guarded('cancelBranch', cancelBranch),
    resumeInFlight,
    tamperTest: guarded('tamperTest', tamperTest),
    timeline,
    // resolves when a commit has fully finished. used by tests and by graceful shutdown.
    settled: (executionId: string) => inFlight.get(executionId) ?? Promise.resolve(),
  };
}

function textOf(result: unknown): unknown {
  const text = (result as { content?: { text?: string }[] } | undefined)?.content?.[0]?.text;
  try {
    return typeof text === 'string' ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function receiptIdOf(result: unknown): string | undefined {
  const id = (textOf(result) as { receipt?: { id?: unknown } } | undefined)?.receipt?.id;
  return typeof id === 'string' ? id : undefined;
}

function inboxOf(result: unknown): unknown[] {
  const messages = (textOf(result) as { messages?: unknown } | undefined)?.messages;
  return Array.isArray(messages) ? messages : [];
}
