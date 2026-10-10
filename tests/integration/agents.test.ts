import { cashCents, schema } from '@fork/db';
import { liquidityShortfall, referenceBranches, type BranchProposal } from '@fork/domain-finance';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { handleInbox } from '../../apps/engine/src/agents/inbox';
import { proposeBranches } from '../../apps/engine/src/agents/planner';
import type { EngineDeps } from '../../apps/engine/src/service';
import { CFO, SCENARIO, world } from '../support/world';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const says = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  warnings: [],
});
const calls = (toolName: string, input: unknown) => ({
  content: [
    {
      type: 'tool-call' as const,
      toolCallId: `call-${toolName}`,
      toolName,
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage,
  warnings: [],
});

// a model that plays back a script, one reply per call, and remembers what it was asked
function scripted(replies: (ReturnType<typeof says> | ReturnType<typeof calls>)[]) {
  const prompts: string[] = [];
  let turn = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      const reply = replies[Math.min(turn, replies.length - 1)]!;
      turn += 1;
      return reply;
    },
  });
  return { model, prompts };
}

const fixtures = (): BranchProposal => ({
  branches: referenceBranches(liquidityShortfall()).map(({ title, rationale, allocations }) => ({
    title,
    rationale,
    allocations,
  })),
});
const withPlanner = (model: MockLanguageModelV4): Pick<EngineDeps, 'planner'> => ({
  planner: (request, check) => proposeBranches(model, request, check),
});
const withInbox = (model: MockLanguageModelV4): Pick<EngineDeps, 'inbox'> => ({
  inbox: (messages, actions) => handleInbox(model, messages, actions),
});

describe('planner', () => {
  it('turns a model answer into proposed branches, never more than that', async () => {
    const { model, prompts } = scripted([says(JSON.stringify(fixtures()))]);
    const w = world({}, true, withPlanner(model));
    const run = w.engine.createRun(CFO.email);
    const branches = await w.engine.proposeBranches(run.id, CFO.email);

    expect(branches.map((branch) => [branch.label, branch.status, branch.source])).toEqual([
      ['A', 'PROPOSED', 'agent'],
      ['B', 'PROPOSED', 'agent'],
      ['C', 'PROPOSED', 'agent'],
    ]);
    // the model is given the books, and nothing it could spend with
    expect(prompts[0]).toContain('INV-05');
    expect(prompts[0]).not.toMatch(/rcp-|recipientId|token|approvedExecutionRef/);
    expect(w.gateway.signCount()).toBe(0);
  });

  it('sends the rejection back and accepts the corrected answer', async () => {
    const bad = fixtures();
    bad.branches[1]!.allocations[0] = { invoiceId: 'INV-01', payCents: 999_999_999 };
    const { model, prompts } = scripted([
      says(JSON.stringify(bad)),
      says(JSON.stringify(fixtures())),
    ]);
    const w = world({}, true, withPlanner(model));
    const run = w.engine.createRun(CFO.email);

    expect(await w.engine.proposeBranches(run.id, CFO.email)).toHaveLength(3);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('INV-01 is overpaid');
  });

  it('gives up after three bad answers and proposes nothing', async () => {
    const invented = {
      branches: [
        {
          title: 'Pay a friend',
          rationale: 'r',
          allocations: [{ invoiceId: 'INV-99', payCents: 100 }],
        },
      ],
    };
    const { model, prompts } = scripted([says(JSON.stringify(invented))]);
    const w = world({}, true, withPlanner(model));
    const run = w.engine.createRun(CFO.email);

    await expect(w.engine.proposeBranches(run.id, CFO.email)).rejects.toMatchObject({
      code: 'PLANNER_FAILED',
    });
    expect(prompts).toHaveLength(3);
    expect(w.engine.getRun(run.id).branches).toHaveLength(0);
    expect(w.engine.timeline(run.id).map((event) => event.type)).toContain('planner.failed');
  });

  it('survives an answer that is not JSON at all', async () => {
    const { model } = scripted([
      says('Sure! Here are some ideas...'),
      says(JSON.stringify(fixtures())),
    ]);
    const w = world({}, true, withPlanner(model));
    const run = w.engine.createRun(CFO.email);
    expect(await w.engine.proposeBranches(run.id, CFO.email)).toHaveLength(3);
  });

  it('says so when no model is configured', async () => {
    const w = world();
    const run = w.engine.createRun(CFO.email);
    await expect(w.engine.proposeBranches(run.id, CFO.email)).rejects.toMatchObject({
      code: 'PLANNER_NOT_CONFIGURED',
    });
  });
});

describe('inbox agent', () => {
  async function commitWithHostileMail(w: ReturnType<typeof world>) {
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    w.engine.injectHostileMessage(run.id, CFO.email);
    const execution = await w.engine.commitBranch(b.id, CFO.email);
    await w.engine.settled(execution.id);
    const view = w.engine.getRun(run.id);
    return { run, b, view, agentSteps: view.steps.filter((step) => step.origin === 'agent') };
  }

  it('is blocked by ArmorIQ when it falls for the email, and the branch stops', async () => {
    const { model, prompts } = scripted([
      calls('update_vendor_destination', {
        vendorId: 'v-northline',
        recipientId: 'recipient-external-999',
      }),
      says('I tried to update the destination but it was refused.'),
    ]);
    const w = world({}, true, withInbox(model));
    const before = w.db.select().from(schema.vendors).all();
    const { view, b, agentSteps } = await commitWithHostileMail(w);

    expect(agentSteps).toHaveLength(1);
    expect(agentSteps[0]).toMatchObject({
      tool: 'update_vendor_destination',
      verdict: 'block',
      source: 'armoriq',
      errorClass: 'IntentMismatchException',
      status: 'NOT_EXECUTED',
      stepIndex: null,
    });
    // the model was told it was refused, and by whom
    expect(prompts[1]).toContain('Refused by ArmorIQ');

    expect(view.branches.find((branch) => branch.id === b.id)?.status).toBe('PARTIALLY_COMMITTED');
    expect(cashCents(w.db, SCENARIO)).toBe(4_600_000);
    expect(w.db.select().from(schema.vendors).all()).toEqual(before);
    expect(
      view.steps.filter((step) => step.origin === 'runner' && step.status === 'NOT_EXECUTED'),
    ).toHaveLength(6);
  });

  it('cannot pay the attacker either: ArmorIQ allows the tool, the MCP refuses the call', async () => {
    const { model } = scripted([
      calls('execute_payment', {
        vendorId: 'v-northline',
        recipientId: 'recipient-external-999',
        amount: 8000,
      }),
      says('The payment was refused.'),
    ]);
    const w = world({}, true, withInbox(model));
    const { agentSteps } = await commitWithHostileMail(w);

    expect(agentSteps[0]).toMatchObject({
      tool: 'execute_payment',
      verdict: 'allow',
      source: 'mcp',
      status: 'NOT_EXECUTED',
    });
    expect(cashCents(w.db, SCENARIO)).toBe(4_600_000);
    expect(w.db.select().from(schema.receipts).all()).toHaveLength(1);
  });

  it('lets the commit finish when the agent leaves the email alone', async () => {
    const { model } = scripted([says('This looks like a phishing attempt. I took no action.')]);
    const w = world({}, true, withInbox(model));
    const { view, b, agentSteps, run } = await commitWithHostileMail(w);

    expect(agentSteps).toHaveLength(0);
    expect(view.branches.find((branch) => branch.id === b.id)?.status).toBe('COMMITTED');
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
    const handled = w.engine.timeline(run.id).find((event) => event.type === 'agent.inbox_handled');
    expect(handled).toMatchObject({ source: 'agent', payload: { attempts: 0 } });
  });

  it('only shows the agent mail that arrived during this run', async () => {
    const { model, prompts } = scripted([says('Nothing to do.')]);
    const w = world({}, true, withInbox(model));
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await w.engine.settled((await w.engine.commitBranch(b.id, CFO.email)).id);
    expect(prompts).toHaveLength(0);
    expect(w.engine.timeline(run.id).some((event) => event.type === 'agent.inbox_handled')).toBe(
      false,
    );
  });
});

describe('replan', () => {
  it('proposes a child branch from the books as they are now, and it needs its own authorization', async () => {
    const remaining = {
      branches: [
        {
          title: 'Finish the rest',
          rationale: 'Pays what branch B still owed. Northline is paid to its registered account.',
          allocations: ['INV-02', 'INV-04', 'INV-06', 'INV-07', 'INV-08'].map((invoiceId) => ({
            invoiceId,
            payCents: liquidityShortfall().invoices.find((invoice) => invoice.id === invoiceId)!
              .amountCents,
          })),
        },
      ],
    };
    const planner = scripted([says(JSON.stringify(remaining))]);
    const inbox = scripted([
      calls('update_vendor_destination', {
        vendorId: 'v-northline',
        recipientId: 'recipient-external-999',
      }),
      says('Refused.'),
    ]);
    const w = world({}, true, { ...withPlanner(planner.model), ...withInbox(inbox.model) });

    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    w.engine.injectHostileMessage(run.id, CFO.email);
    await w.engine.settled((await w.engine.commitBranch(b.id, CFO.email)).id);

    const [child] = await w.engine.replan(b.id, CFO.email);
    expect(child).toMatchObject({
      parentId: b.id,
      label: 'B′',
      source: 'replan',
      status: 'PROPOSED',
      approvedPlanHash: null,
    });
    expect(child!.baseSnapshotHash).not.toBe(b.baseSnapshotHash);
    expect(planner.prompts[0]).toContain('update_vendor_destination was refused');
    expect(planner.prompts[0]).toContain('cashCents\\":4600000');

    // not approved, so it cannot run
    await expect(w.engine.commitBranch(child!.id, CFO.email)).rejects.toThrow(
      /cannot go from PROPOSED/,
    );
    expect(w.gateway.signCount()).toBe(1);

    // with a fresh authorization it finishes the job
    w.engine.simulateBranch(child!.id);
    w.engine.authorizeBranch(child!.id, CFO.email);
    await w.engine.settled((await w.engine.commitBranch(child!.id, CFO.email)).id);
    expect(w.engine.getRun(run.id).branches.find((branch) => branch.id === child!.id)?.status).toBe(
      'COMMITTED',
    );
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
  });

  it('refuses to replan a branch that did not stop short', async () => {
    const w = world({}, true, withPlanner(scripted([says('{}')]).model));
    const { b } = w.simulated();
    await expect(w.engine.replan(b.id, CFO.email)).rejects.toMatchObject({
      code: 'NOTHING_TO_REPLAN',
    });
  });
});
