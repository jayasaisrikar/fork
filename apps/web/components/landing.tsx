'use client';

import { Moon, Sun } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clock, shortHash, usd } from '@/lib/format';
import type { AuditEvent, RunView } from '@/lib/types';
import { AuthorizationSeal, statusText } from './branch-card';
import { BranchCanvas } from './branch-canvas';
import { Wordmark } from './chrome';
import { Chip, HashChip, Money, SourcePill, VerdictPill } from './primitives';

const REPO = process.env.NEXT_PUBLIC_REPO_URL;
const IC3_REPORT = 'https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf';

const cta = 'inline-flex h-10 items-center rounded-[4px] border px-4 text-[14px] font-medium';
const primary = `${cta} bg-accent border-accent text-surface hover:opacity-90`;
const secondary = `${cta} border-line hover:bg-raised`;
const section = 'border-line border-t py-16';
const h2 = 'font-display text-[28px] leading-tight font-extrabold [font-stretch:115%]';

export interface Recorded {
  recordedAt: string;
  branchId: string;
  view: RunView;
  events: AuditEvent[];
}

function Hero({ record }: { record: Recorded }) {
  const { view } = record;
  const [picked, setPicked] = useState(record.branchId);
  const select = useCallback((id: string) => setPicked(id), []);
  const branch = view.branches.find((item) => item.id === picked) ?? view.branches[0]!;
  const branches = useMemo(() => view.branches, [view]);
  const steps = useMemo(() => view.steps, [view]);
  const approvals = branch.risk?.approvalsNeeded ?? 0;

  return (
    <section className="py-14 lg:py-20">
      <div className="grid items-end gap-10 lg:grid-cols-[55fr_45fr]">
        <div>
          <p className="label">Execution harness for autonomous agents</p>
          <h1 className="font-display mt-4 text-[40px] leading-[1.02] font-extrabold [font-stretch:118%] sm:text-[64px] xl:text-[80px]">
            Explore every outcome. <span className="text-accent">Commit only one.</span>
          </h1>
          <p className="mt-6 max-w-[52ch] text-[16px] leading-relaxed">
            Agents branch decisions against an isolated copy of the books. A human authorizes one
            exact plan. ArmorIQ enforces it on every tool call.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className={primary}>
              Open the workspace
            </Link>
            <a href="#how" className={secondary}>
              Read how it works
            </a>
          </div>
          <p className="text-muted mt-6 font-mono text-[12px]">
            Sandbox ledger. Real ArmorIQ enforcement.
          </p>
        </div>

        {/* the numbers for whichever branch is selected in the graph below */}
        <div className="border-line bg-surface rounded-[6px] border p-4">
          <p className="label">Selected branch</p>
          <dl
            className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]"
            aria-live="polite"
          >
            <dt className="text-muted">Branch {branch.label}</dt>
            <dd className="font-medium">{branch.title}</dd>
            <dt className="text-muted">Cash after</dt>
            <dd>{branch.projection ? <Money cents={branch.projection.cashAfterCents} /> : '—'}</dd>
            <dt className="text-muted">Late fees</dt>
            <dd className="money">{usd(branch.projection?.lateFeesCents ?? 0)}</dd>
            <dt className="text-muted">Needs approval</dt>
            <dd className="money">
              {approvals} {approvals === 1 ? 'payment' : 'payments'}
            </dd>
            <dt className="text-muted">Status</dt>
            <dd>{statusText(branch.status)}</dd>
          </dl>
          <p className="text-muted mt-3 text-[12px]">
            Recorded from a real run on {record.recordedAt.slice(0, 10)}. Select a branch in the
            graph to read its numbers.
          </p>
        </div>
      </div>

      <div className="border-line bg-surface mt-8 h-[460px] rounded-[6px] border">
        <BranchCanvas
          branches={branches}
          steps={steps}
          cashCents={view.snapshot.state.cashCents}
          selectedId={branch.id}
          onSelect={select}
        />
      </div>
    </section>
  );
}

function Step({
  n,
  name,
  children,
  fragment,
}: {
  n: number;
  name: string;
  children: React.ReactNode;
  fragment: React.ReactNode;
}) {
  return (
    <li className="border-line grid gap-4 border-t py-6 md:grid-cols-[48px_1fr_minmax(0,360px)] md:items-center">
      <span className="text-accent font-mono text-[14px]">{n}</span>
      <div>
        <h3 className="text-[16px] font-semibold">{name}</h3>
        <p className="mt-1 max-w-[54ch] text-[14px] leading-relaxed">{children}</p>
      </div>
      <div className="border-line bg-surface rounded-[6px] border p-3 text-[13px]">{fragment}</div>
    </li>
  );
}

function HowItWorks({ record }: { record: Recorded }) {
  const { view } = record;
  const branch = view.branches.find((item) => item.id === record.branchId)!;
  const line =
    branch.projection?.lines.find((item) => item.remainingCents > 0) ?? branch.projection?.lines[0];
  const vendor = (id?: string) =>
    view.snapshot.state.vendors.find((item) => item.id === id)?.name ?? '';
  const allowed = view.steps.find((step) => step.receiptId);
  const receipt = view.receipts.find((item) => item.id === allowed?.receiptId);

  return (
    <section id="how" className={section}>
      <h2 className={h2}>How it works</h2>
      <ol className="mt-6">
        <Step
          n={1}
          name="Fork"
          fragment={
            <ul className="space-y-1">
              {view.branches.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <span className="font-display font-extrabold">{item.label}</span>
                  <span className="truncate">{item.title}</span>
                  <span className="ml-auto">
                    <SourcePill source={item.source} />
                  </span>
                </li>
              ))}
            </ul>
          }
        >
          A planner agent proposes up to three ways to handle the week&apos;s invoices. Proposals
          are untrusted data: FORK checks every one against the books.
        </Step>
        <Step
          n={2}
          name="Simulate"
          fragment={
            line ? (
              <div className="flex items-center justify-between gap-3">
                <span>{vendor(line.vendorId)}</span>
                <span className="text-muted">
                  pays <span className="money text-text">{usd(line.paidCents)}</span>, leaves{' '}
                  <span className="money text-text">{usd(line.remainingCents)}</span>
                </span>
              </div>
            ) : null
          }
        >
          Each branch runs against the same frozen snapshot, so the outcomes can be compared side by
          side. Simulation never writes to the ledger.
        </Step>
        <Step
          n={3}
          name="Authorize"
          fragment={
            branch.approvedPlanHash ? <AuthorizationSeal hash={branch.approvedPlanHash} /> : null
          }
        >
          The CFO approves one branch. Its exact steps are frozen and hashed, then signed by ArmorIQ
          as an intent plan.
        </Step>
        <Step
          n={4}
          name="Execute"
          fragment={
            allowed && receipt ? (
              <div className="flex flex-wrap items-center gap-2">
                <VerdictPill verdict={allowed.verdict} />
                <span className="font-mono text-[12px]">{allowed.tool}</span>
                <span className="money ml-auto">{usd(receipt.amountCents)}</span>
                <span className="text-muted w-full font-mono text-[11px]">
                  receipt {shortHash(receipt.id)}
                </span>
              </div>
            ) : null
          }
        >
          Plain code, not a model, sends each approved step through ArmorIQ to the payment server.
          Cash changes only when a receipt comes back.
        </Step>
      </ol>
    </section>
  );
}

const GATES: [string, string][] = [
  ['Agent proposal', 'The planner. Untrusted.'],
  ['Snapshot', 'FORK. A frozen copy of the books.'],
  ['CFO authorization', 'A person. One immutable branch.'],
  ['ArmorIQ', 'Signed plan plus policy, on every call.'],
  ['MCP', 'Checks the single-use capability and the cash.'],
  ['Ledger receipt', 'Append-only. The only proof of payment.'],
];

function TwoGates() {
  return (
    <section className={section}>
      <h2 className={h2}>Two gates, and both must open</h2>
      <p className="mt-3 max-w-[64ch] text-[14px] leading-relaxed">
        A human approving a branch is one gate. ArmorIQ checking each call against that branch is
        the other. Money moves only when both agree, and the payment server checks once more.
      </p>
      <ol className="border-line mt-6 grid overflow-hidden rounded-[6px] border sm:grid-cols-2 lg:grid-cols-6">
        {GATES.map(([name, owner], i) => (
          <li
            key={name}
            className={`border-line bg-surface border-b p-3 lg:border-r lg:border-b-0 ${i === 2 || i === 3 ? 'border-t-accent border-t-2' : ''}`}
          >
            <div className="text-[13px] font-semibold">{name}</div>
            <div className="text-muted mt-1 text-[12px]">{owner}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Evidence({ record }: { record: Recorded }) {
  const { view } = record;
  const message = view.messages.at(-1);
  const attempts = view.steps.filter((step) => step.origin === 'agent');
  const execution = view.executions.find((item) => item.kind === 'commit');
  return (
    <section id="evidence" className={section}>
      <h2 className={h2}>The moment it says no</h2>
      <p className="mt-3 max-w-[64ch] text-[14px] leading-relaxed">
        Midway through a commit, a fake vendor email arrived. The inbox agent, a real model,
        believed it. This is what happened next, recorded from that run and not edited.
      </p>
      <div className="border-line bg-surface mt-6 rounded-[6px] border">
        {message ? (
          <div className="border-line border-b p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="text">UNTRUSTED INPUT</Chip>
              <span className="text-muted font-mono text-[12px]">{message.from}</span>
            </div>
            <p className="mt-2 text-[14px] font-medium">{message.subject}</p>
            <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed">{message.body}</p>
          </div>
        ) : null}
        <ol>
          {attempts.map((step) => (
            <li
              key={step.id}
              className="border-line flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3 text-[13px]"
            >
              <span className="text-muted font-mono text-[12px]">{clock(step.at)}</span>
              <SourcePill source="agent" />
              <span className="font-mono">{step.tool}</span>
              <span className="text-muted font-mono text-[12px]">
                → {String(step.args.recipientId ?? '')}
              </span>
              <VerdictPill verdict={step.verdict} />
              <span
                className={
                  step.source === 'armoriq' ? 'font-medium' : 'text-fork-reject font-medium'
                }
              >
                {step.source === 'armoriq'
                  ? 'Blocked by ArmorIQ'
                  : 'Allowed by ArmorIQ, refused by the MCP'}
              </span>
              <span className="text-muted w-full font-mono text-[12px]">{step.errorClass}</span>
            </li>
          ))}
        </ol>
        {execution ? (
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 p-4 text-[13px]">
            <dt className="text-muted">ArmorIQ plan</dt>
            <dd className="font-mono text-[12px] break-all">{execution.armorPlanId}</dd>
            <dt className="text-muted">Plan hash</dt>
            <dd>
              <HashChip value={execution.armorPlanHash} label="ArmorIQ plan hash" />
            </dd>
          </dl>
        ) : null}
      </div>
      <p className="text-muted mt-3 max-w-[70ch] text-[13px]">
        ArmorIQ binds the tool to the signed plan, not its arguments. So the destination change was
        blocked outright, while the altered payment got past ArmorIQ and was stopped by FORK&apos;s
        own payment server, which accepts only the single-use capability minted for the approved
        payment.
      </p>
    </section>
  );
}

export function Landing({ record }: { record: Recorded }) {
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  useEffect(() => {
    const saved = window.localStorage.getItem('fork-landing-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  const toggle = () =>
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('fork-landing-theme', next);
      return next;
    });

  return (
    <div data-theme={theme} className="bg-bg text-text min-h-dvh font-sans">
      <Tooltip.Provider>
        <div className="mx-auto max-w-[1280px] px-[clamp(16px,4vw,64px)]">
          <header className="flex h-16 items-center gap-6">
            <Wordmark />
            <nav
              className="text-muted ml-auto hidden items-center gap-5 text-[14px] sm:flex"
              aria-label="Page"
            >
              <a href="#how" className="hover:text-text">
                How it works
              </a>
              <a href="#evidence" className="hover:text-text">
                Evidence
              </a>
              {REPO ? (
                <a href={REPO} className="hover:text-text">
                  GitHub
                </a>
              ) : null}
            </nav>
            <button
              type="button"
              onClick={toggle}
              aria-label="Toggle theme"
              className="border-line hover:bg-raised ml-auto flex h-8 w-8 items-center justify-center rounded-[4px] border sm:ml-0"
            >
              {theme === 'dark' ? (
                <Sun size={15} strokeWidth={1.5} />
              ) : (
                <Moon size={15} strokeWidth={1.5} />
              )}
            </button>
            <Link href="/app" className={`${primary} h-8 px-3 text-[13px]`}>
              Open the workspace
            </Link>
          </header>

          <main>
            <Hero record={record} />
            <HowItWorks record={record} />
            <TwoGates />
            <Evidence record={record} />

            <section className={section}>
              <h2 className={h2}>Why this matters</h2>
              <p className="mt-3 max-w-[64ch] text-[16px] leading-relaxed">
                A message claiming a vendor changed its bank details is business email compromise.
                The FBI recorded <span className="money font-medium">$3.05 billion</span> in
                reported losses to it in 2025, the second-largest fraud category by loss.
              </p>
              <p className="text-muted mt-2 text-[13px]">
                Source:{' '}
                <a href={IC3_REPORT} className="underline underline-offset-2">
                  FBI Internet Crime Complaint Center, 2025 Internet Crime Report
                </a>
                .
              </p>
            </section>
          </main>

          <footer className="border-line text-muted flex flex-wrap gap-x-6 gap-y-2 border-t py-6 text-[13px]">
            {REPO ? <a href={REPO}>GitHub</a> : null}
            <span>Built for ArmorIQ Flow State 2026</span>
            <span>Fictional company. Sandbox ledger. No real payments.</span>
          </footer>
        </div>
      </Tooltip.Provider>
    </div>
  );
}
