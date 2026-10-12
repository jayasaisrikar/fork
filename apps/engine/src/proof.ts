// public security probes. each one signs its own throwaway ArmorIQ plan and dispatches a fixed,
// preselected call. nothing here can change an approved branch, and nothing here can pay.
import type { DispatchResult, Gateway, PlanStep } from '@fork/armor-adapter';
import { cashCents, loadState, schema, type Db } from '@fork/db';
import { PROOF_SCENARIO, referenceBranches, type TreasuryState } from '@fork/domain-finance';
import { PAYMENT_TOOL } from '@fork/shared';
import {
  mintCapability,
  paymentArgsHash,
  verifyCapability,
  type PaymentArgs,
} from '@fork/shared/capability';
import { hashCanonical } from '@fork/shared/hash';
import { and, asc, count, desc, eq, gte, isNull } from 'drizzle-orm';
import { ApiError, PROOF_ACTOR, type Engine } from './service';

const { branchActions, branches, ledgerPostings, proofRuns, runs } = schema;

export const ATTACKS = [
  'policy_blocked_tool',
  'altered_recipient',
  'altered_amount',
  'unplanned_tool',
] as const;
export type Attack = (typeof ATTACKS)[number];

const TREASURY = 'liquidity-shortfall';
const ATTACKER_RECIPIENT = 'recipient-external-999';
// $4,000 becomes $5,000
const RAISE_CENTS = 100_000;
const CAPABILITY_SECONDS = 120;
const PLAN_SECONDS = 300;

interface Observed {
  armoriq: 'allow' | 'block' | 'error';
  enforcedBy: 'armoriq_policy' | 'armoriq_sdk' | 'fork_mcp' | null;
  outcome: 'executed' | 'refused' | 'not_reached';
  errorClass: string | null;
}

export interface ProofStep extends Observed {
  tool: string;
  matchedExpectation: boolean;
}

export interface ProofResult {
  attack: Attack;
  ranAt: string;
  armorPlanId: string;
  reference: { vendor: string; amountCents: number; approvedPlanHash: string };
  capabilityCheck: {
    originalArguments: 'valid' | 'invalid';
    alteredArguments: 'valid' | 'invalid';
  } | null;
  steps: ProofStep[];
  ledger: {
    sandbox: { cashBeforeCents: number; cashAfterCents: number; postingsAdded: number };
    treasury: { postingsAdded: number };
  };
  integrity: 'ok' | 'failed';
}

export interface ProofDeps {
  db: Db;
  engine: Engine;
  // null when ArmorIQ is not configured. nothing is dispatched and the caller is told why.
  gateway: Gateway | null;
  gatewayMissingReason?: string;
  capabilitySecret: string;
  now?: () => Date;
  cooldownSeconds?: number;
  dailyLimit?: number;
}

export type Proof = ReturnType<typeof createProof>;

const ALLOWED_READ: Observed = {
  armoriq: 'allow',
  enforcedBy: null,
  outcome: 'executed',
  errorClass: null,
};
const REFUSED_BY_MCP: Observed = {
  armoriq: 'allow',
  enforcedBy: 'fork_mcp',
  outcome: 'refused',
  errorClass: 'CAPABILITY_INVALID',
};
// what each preset should produce. the result always reports what actually happened.
const EXPECTED: Record<Attack, Observed> = {
  policy_blocked_tool: {
    armoriq: 'block',
    enforcedBy: 'armoriq_policy',
    outcome: 'not_reached',
    errorClass: 'PolicyBlockedException',
  },
  altered_recipient: REFUSED_BY_MCP,
  altered_amount: REFUSED_BY_MCP,
  unplanned_tool: {
    armoriq: 'block',
    enforcedBy: 'armoriq_sdk',
    outcome: 'not_reached',
    errorClass: 'IntentMismatchException',
  },
};

function observe(decision: DispatchResult): Observed {
  if (decision.verdict === 'allow') {
    // ArmorIQ said yes. whether the tool then ran is a separate fact.
    return {
      armoriq: 'allow',
      enforcedBy: decision.toolError ? 'fork_mcp' : null,
      outcome: decision.toolError ? 'refused' : 'executed',
      errorClass: decision.toolError?.code ?? null,
    };
  }
  const errorClass = decision.errorClass ?? null;
  return {
    armoriq: decision.verdict === 'block' ? 'block' : 'error',
    enforcedBy:
      errorClass === 'PolicyBlockedException'
        ? 'armoriq_policy'
        : errorClass === 'IntentMismatchException'
          ? 'armoriq_sdk'
          : null,
    outcome: 'not_reached',
    errorClass,
  };
}

const told = (step: PlanStep, decision: DispatchResult, expected: Observed): ProofStep => {
  const seen = observe(decision);
  return {
    tool: step.action,
    ...seen,
    matchedExpectation: (Object.keys(expected) as (keyof Observed)[]).every(
      (key) => seen[key] === expected[key],
    ),
  };
};

const limited = (message: string, retryAfterSeconds: number) =>
  new ApiError('RATE_LIMITED', 429, message, { retryAfterSeconds });

export function createProof(deps: ProofDeps) {
  const { db, engine, capabilitySecret } = deps;
  const now = deps.now ?? (() => new Date());
  const cooldown = deps.cooldownSeconds ?? 20;
  const dailyLimit = deps.dailyLimit ?? 200;
  // one probe at a time. the engine is one process, so this is enough.
  let busy = false;

  const postingsIn = (scenarioId: string) =>
    db
      .select({ n: count() })
      .from(ledgerPostings)
      .where(eq(ledgerPostings.scenarioId, scenarioId))
      .get()?.n ?? 0;
  const books = () => ({
    sandboxCash: cashCents(db, PROOF_SCENARIO),
    sandboxPostings: postingsIn(PROOF_SCENARIO),
    treasuryPostings: postingsIn(TREASURY),
  });

  // refuses or records the run in one step, so two callers cannot both get through
  function admit(attack: Attack, at: Date): number {
    return db.transaction(
      (tx) => {
        const failed = tx
          .select({ id: proofRuns.id })
          .from(proofRuns)
          .where(and(eq(proofRuns.integrityFailure, true), isNull(proofRuns.clearedAt)))
          .get();
        if (failed) {
          throw new ApiError(
            'PROOF_DISABLED',
            503,
            'Proof Mode is switched off after an integrity failure. An administrator has to clear it.',
          );
        }

        const last = tx
          .select({ startedAt: proofRuns.startedAt })
          .from(proofRuns)
          .orderBy(desc(proofRuns.id))
          .get();
        const waited = last ? (at.getTime() - Date.parse(last.startedAt)) / 1000 : Infinity;
        if (waited < cooldown)
          throw limited('Proof Mode is cooling down', Math.ceil(cooldown - waited));

        // the cap is per UTC day
        const midnight = `${at.toISOString().slice(0, 10)}T00:00:00.000Z`;
        const today =
          tx.select({ n: count() }).from(proofRuns).where(gte(proofRuns.startedAt, midnight)).get()
            ?.n ?? 0;
        if (today >= dailyLimit) {
          throw limited(
            "Today's proof runs are used up",
            Math.ceil((Date.parse(midnight) + 86_400_000 - at.getTime()) / 1000),
          );
        }

        return tx
          .insert(proofRuns)
          .values({ attack, startedAt: at.toISOString() })
          .returning({ id: proofRuns.id })
          .get().id;
      },
      { behavior: 'immediate' },
    );
  }

  const finish = (id: number, patch: Partial<typeof proofRuns.$inferInsert>) =>
    db
      .update(proofRuns)
      .set({ finishedAt: now().toISOString(), ...patch })
      .where(eq(proofRuns.id, id))
      .run();

  function authorizeFresh(state: TreasuryState) {
    const run = engine.createRun(PROOF_ACTOR, PROOF_SCENARIO, 'system');
    const fixtures = referenceBranches(state).map(({ title, rationale, allocations }) => ({
      title,
      rationale,
      allocations,
    }));
    const b = engine.addBranches(run.id, { branches: fixtures }, 'fixture')[1]!;
    engine.simulateBranch(b.id);
    return engine.authorizeBranch(b.id, PROOF_ACTOR, 'system').branch;
  }

  // the standing system authorization on the sandbox, made once and reused while the books match
  function reference() {
    const state = loadState(db, PROOF_SCENARIO);
    if (!state) throw new ApiError('NOT_FOUND', 404, 'The proof sandbox has not been seeded');
    const standing = db
      .select()
      .from(branches)
      .innerJoin(runs, eq(runs.id, branches.runId))
      .where(
        and(
          eq(runs.scenarioId, PROOF_SCENARIO),
          eq(branches.status, 'APPROVED'),
          eq(branches.baseSnapshotHash, hashCanonical(state)),
        ),
      )
      .orderBy(desc(runs.id))
      .get()?.branches;
    const branch = standing ?? authorizeFresh(state);

    const payment = db
      .select()
      .from(branchActions)
      .where(and(eq(branchActions.branchId, branch.id), eq(branchActions.kind, 'write')))
      .orderBy(asc(branchActions.stepIndex))
      .get();
    if (!payment || payment.tool !== PAYMENT_TOOL)
      throw new Error('the proof reference branch has no small payment to measure against');
    const args = payment.args as unknown as PaymentArgs;
    return {
      runId: branch.runId,
      approvedPlanHash: branch.approvedPlanHash ?? '',
      args,
      vendor: state.vendors.find((vendor) => vendor.id === args.vendorId)?.name ?? args.vendorId,
    };
  }

  async function probe(attack: Attack, gateway: Gateway): Promise<ProofResult> {
    const at = now();
    const rowId = admit(attack, at);
    const ref = reference();
    const before = books();
    const nowSeconds = Math.floor(at.getTime() / 1000);

    // the one stored at authorization expires after 30 minutes. this one is for this probe only
    // and is never sent with the arguments it is good for.
    const capability = mintCapability(
      capabilitySecret,
      { runId: `proof:${rowId}`, stepIndex: 0, exp: nowSeconds + CAPABILITY_SECONDS },
      paymentArgsHash(ref.args),
    );
    const pay = (args: PaymentArgs): PlanStep => ({
      action: PAYMENT_TOOL,
      params: { ...args, amount: args.amountCents / 100, approvedExecutionRef: capability },
    });
    const read: PlanStep = {
      action: 'get_treasury_balance',
      params: { scenarioId: PROOF_SCENARIO },
    };
    const redirect: PlanStep = {
      action: 'update_vendor_destination',
      params: { vendorId: ref.args.vendorId, recipientId: ATTACKER_RECIPIENT },
    };

    const altered: PaymentArgs | null =
      attack === 'altered_recipient'
        ? { ...ref.args, recipientId: ATTACKER_RECIPIENT }
        : attack === 'altered_amount'
          ? { ...ref.args, amountCents: ref.args.amountCents + RAISE_CENTS }
          : null;
    const attempt = altered ? pay(altered) : redirect;
    // a synthetic plan of its own. the approved branch's steps and hash are never part of this.
    const signed =
      attack === 'unplanned_tool'
        ? [read]
        : attack === 'policy_blocked_tool'
          ? [read, redirect]
          : [read, pay(ref.args)];

    const check = (args: PaymentArgs) =>
      verifyCapability(capabilitySecret, capability, paymentArgsHash(args), nowSeconds).ok
        ? ('valid' as const)
        : ('invalid' as const);
    const capabilityCheck = altered
      ? { originalArguments: check(ref.args), alteredArguments: check(altered) }
      : null;

    let plan;
    try {
      plan = await gateway.sign(
        `FORK security probe (${attack}). Not a CFO-approved plan.`,
        signed,
        PLAN_SECONDS,
      );
    } catch (error) {
      finish(rowId, {});
      throw new ApiError(
        'ARMORIQ_UNAVAILABLE',
        503,
        "ArmorIQ didn't respond. Nothing was dispatched.",
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const steps: ProofStep[] = [];
    let thrown: unknown;
    try {
      steps.push(told(read, await gateway.dispatch(plan.planId, read), ALLOWED_READ));
      steps.push(told(attempt, await gateway.dispatch(plan.planId, attempt), EXPECTED[attack]));
    } catch (error) {
      thrown = error;
    }
    await gateway.close(plan.planId, 'failed').catch(() => undefined);

    // the sandbox opens with postings of its own, so the test is "none added", in either scenario
    const after = books();
    const ledger = {
      sandbox: {
        cashBeforeCents: before.sandboxCash,
        cashAfterCents: after.sandboxCash,
        postingsAdded: after.sandboxPostings - before.sandboxPostings,
      },
      treasury: { postingsAdded: after.treasuryPostings - before.treasuryPostings },
    };
    const intact =
      ledger.sandbox.postingsAdded === 0 &&
      ledger.treasury.postingsAdded === 0 &&
      before.sandboxCash === after.sandboxCash;
    if (!intact) {
      // fail closed, and stay closed across restarts until someone has looked
      finish(rowId, { integrityFailure: true });
      engine.audit(
        ref.runId,
        'fork',
        'security.proof_integrity_failure',
        PROOF_ACTOR,
        { proofRunId: rowId, planId: plan.planId },
        { attack, ledger },
      );
    }
    if (thrown) {
      finish(rowId, {});
      throw thrown;
    }

    const result: ProofResult = {
      attack,
      ranAt: at.toISOString(),
      armorPlanId: plan.planId,
      reference: {
        vendor: ref.vendor,
        amountCents: ref.args.amountCents,
        approvedPlanHash: ref.approvedPlanHash,
      },
      capabilityCheck,
      steps,
      ledger,
      integrity: intact ? 'ok' : 'failed',
    };
    finish(rowId, { result });
    engine.audit(
      ref.runId,
      'fork',
      'proof.run',
      PROOF_ACTOR,
      { proofRunId: rowId, planId: plan.planId },
      { attack, steps },
    );
    return result;
  }

  async function run(attack: Attack): Promise<ProofResult> {
    if (busy) throw limited('Another proof run is in progress', 5);
    busy = true;
    try {
      if (!deps.gateway) {
        throw new ApiError(
          'ARMORIQ_NOT_CONFIGURED',
          503,
          deps.gatewayMissingReason ?? 'ArmorIQ is not configured. Nothing was dispatched.',
        );
      }
      return await probe(attack, deps.gateway);
    } finally {
      busy = false;
    }
  }

  // for an administrator, after looking into what went wrong. returns how many were cleared.
  function reset(): number {
    const cleared = db
      .update(proofRuns)
      .set({ clearedAt: now().toISOString() })
      .where(and(eq(proofRuns.integrityFailure, true), isNull(proofRuns.clearedAt)))
      .returning({ id: proofRuns.id })
      .all();
    if (cleared.length) {
      engine.audit(null, 'fork', 'proof.integrity_reset', 'admin', {
        proofRunIds: cleared.map((row) => row.id),
      });
    }
    return cleared.length;
  }

  return { run, reset };
}
