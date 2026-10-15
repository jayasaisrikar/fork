'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { Shell } from '@/components/chrome';
import { buttonClass, Disclosure, Field, Insight, Tag } from '@/components/primitives';

const FLOW: [string, string, string][] = [
  [
    'Propose',
    'AI planner',
    'A model drafts alternative plans as validated, structured actions. Its output is untrusted data.',
  ],
  [
    'Compare',
    'Branch engine',
    'Each plan is simulated against the same frozen snapshot. Plans the money cannot cover are rejected here.',
  ],
  [
    'Approve',
    'Human gate',
    'The CFO approves one plan. Its exact steps are frozen and hashed, and cannot be edited.',
  ],
  [
    'Enforce',
    'ArmorIQ',
    'The approved steps are signed as an intent plan. Every tool call is checked against it and against policy.',
  ],
  [
    'Verify',
    'MCP + ledger',
    'The payment server accepts only a single-use capability, writes an append-only receipt, and is reconciled.',
  ],
];

const OWNERS: [string, string][] = [
  ['Snapshot isolation', 'Harness'],
  ['Branch lifecycle and state', 'Harness'],
  ['Simulation and feasibility', 'Domain adapter'],
  ['Human approval and plan hash', 'Harness'],
  ['Intent signing and policy', 'ArmorIQ'],
  ['Large-payment holds', 'ArmorIQ'],
  ['Payments and receipts', 'Finance MCP'],
  ['Audit log and reconciliation', 'Harness + ledger'],
];

const REFUSALS: [string, 'purple' | 'bad' | 'gold', string, string][] = [
  [
    'Rejected by FORK',
    'purple',
    'Before ArmorIQ is asked',
    'The plan itself cannot work, for example it overdraws the account or breaks the minimum reserve. It can never be approved.',
  ],
  [
    'Blocked by ArmorIQ',
    'bad',
    'On a tool call',
    "The agent's tool call is not in the signed plan, or policy forbids it. A bank-detail change that nobody approved stops here.",
  ],
  [
    'Held by ArmorIQ',
    'gold',
    'On a tool call',
    'The call is allowed but large. It waits until a person approves it on the ArmorIQ platform. FORK cannot approve it.',
  ],
  [
    'Refused by the MCP',
    'purple',
    'After ArmorIQ allows',
    'The payment server rejects a request with a missing capability, a different recipient, or not enough cash.',
  ],
];

const CONTRACT = `interface ForkDomainAdapter<Base, Action, Projection, Diff, Receipt> {
  validateActions(base: Base, input: unknown): Action[];
  simulate(base: Base, actions: Action[]): Projection;
  diff(base: Base, projected: Projection): Diff;
  feasibility(base: Base, projection: Projection): Feasibility;
  toToolSteps(
    base: Base, actions: Action[], idempotencyPrefix: string,
  ): CanonicalToolStep[];
  verifyPostcondition(
    before: Base, after: Base, receipts: Receipt[],
  ): VerificationResult;
}`;

export default function HowPage() {
  return (
    <Shell active="How it works">
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-10 lg:px-8">
        <div className="eyebrow">Under the hood</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="max-w-[18ch] text-[34px] leading-[1.08] font-extrabold sm:text-[44px]">
              An execution harness, not another chatbot.
            </h1>
            <p className="text-muted mt-3 max-w-[64ch] text-[15px] leading-relaxed">
              The treasury screen is one application. Underneath is a reusable branch-and-commit
              engine that controls agent state, approval, and tool execution.
            </p>
          </div>
          <Link href="/app" className={buttonClass('primary')}>
            Open the decision studio <ArrowUpRight size={15} strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <section className="card mt-8 p-5 lg:p-6">
          <h2 className="text-[20px] font-extrabold">How a decision becomes an action</h2>
          <ol className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {FLOW.map(([verb, owner, text], i) => (
              <li key={verb} className="border-line bg-bg rounded-[10px] border p-4">
                <div className="label">
                  0{i + 1} / {verb}
                </div>
                <div className="mt-2 text-[15px] font-extrabold">{owner}</div>
                <p className="text-muted mt-1.5 text-[12px] leading-relaxed">{text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4">
            <Insight tone="good">
              <b>Two independent permission boundaries.</b> A person approves the plan through the
              harness. ArmorIQ then verifies intent and policy on every call before the payment
              server will act. Plain code, not a model, drives the approved steps.
            </Insight>
          </div>
        </section>

        <section className="mt-4">
          <div className="card p-5 lg:p-6">
            <h2 className="text-[20px] font-extrabold">Four ways a call can be stopped</h2>
            <p className="text-muted mt-1.5 max-w-[70ch] text-[13px] leading-relaxed">
              These are separate outcomes from separate systems. The interface never shows one in
              the colors of another, so you always know who said no.
            </p>
            <ul className="mt-5 grid grid-cols-1 gap-2 md:grid-cols-2">
              {REFUSALS.map(([name, tone, when, text]) => (
                <li key={name} className="border-line rounded-[10px] border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Tag tone={tone}>{name}</Tag>
                    <span className="text-muted text-[12px]">{when}</span>
                  </div>
                  <p className="mt-2.5 text-[13px] leading-relaxed">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="card p-5 lg:p-6">
            <h2 className="text-[20px] font-extrabold">What makes it reusable?</h2>
            <p className="text-muted mt-2 text-[13px] leading-relaxed">
              The harness owns branches, lifecycle, approvals, execution checkpoints and the event
              history. A domain supplies its own simulation rules and tools. Treasury is the first
              one.
            </p>
            <dl className="mt-3">
              {OWNERS.map(([what, who]) => (
                <Field key={what} name={what}>
                  <span className="font-mono text-[12px]">{who}</span>
                </Field>
              ))}
            </dl>
          </section>
          <section className="card p-5 lg:p-6">
            <h2 className="text-[20px] font-extrabold">The contract</h2>
            <p className="text-muted mt-2 text-[13px]">
              A domain adapter implements one small typed interface.
            </p>
            <pre className="bg-panel text-bright mt-4 overflow-x-auto rounded-[10px] p-4 font-mono text-[12px] leading-[1.75]">
              {CONTRACT}
            </pre>
            <p className="text-muted mt-3 text-[12px]">
              From <span className="font-mono">packages/harness/src/adapter.ts</span>.
            </p>
          </section>
        </div>

        <div className="mt-4">
          <Disclosure title="What is real in this demo, and what is not?" aside="Honest scope">
            <ul className="text-muted list-disc space-y-1.5 px-5 py-4 pl-9 text-[13px] leading-relaxed">
              <li>
                Real: the planner and inbox agents are live models, and ArmorIQ verdicts are
                recorded from real ArmorIQ responses.
              </li>
              <li>
                Sandbox: the company, its vendors, the bank ledger and the payments. No real money
                moves.
              </li>
              <li>
                The two safeguard tests in the studio are deliberate, and every record labels them
                as security tests rather than agent behavior.
              </li>
            </ul>
          </Disclosure>
        </div>
      </main>
    </Shell>
  );
}
