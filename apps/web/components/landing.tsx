'use client';

import { ArrowRight, ArrowUpRight, Ban, Check, Mail } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { describeStep } from '@/lib/describe';
import { clock, usd, usdShort } from '@/lib/format';
import type { AuditEvent, RunView } from '@/lib/types';
import { statusText } from './branch-card';
import { BranchCanvas } from './branch-canvas';
import { Shell } from './chrome';
import { buttonClass, Chip, HashChip, SourcePill, Tag, VerdictPill } from './primitives';

const REPO = process.env.NEXT_PUBLIC_REPO_URL;
const IC3_REPORT = 'https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf';

// every claim here was checked against the linked page, keep it that way
const PAIN_POINTS = [
  {
    text: 'Hidden instructions on web pages already tricked live AI agents into sending crypto payments.',
    source: 'SecurityWeek on Zscaler research, Jul 2026',
    href: 'https://www.securityweek.com/prompt-injection-attacks-trick-ai-agents-into-making-crypto-payments/',
  },
  {
    text: 'Malicious prompt injection on the web rose 32% between Nov 2025 and Feb 2026, including a payload forcing a $5,000 PayPal transfer.',
    source: 'Cloud Security Alliance, citing Google and Forcepoint, Apr 2026',
    href: 'https://labs.cloudsecurityalliance.org/research/csa-research-note-indirect-prompt-injection-in-the-wild-2026/',
  },
  {
    text: 'OWASP ranks agent goal hijack and tool misuse as the top two risks for agentic applications.',
    source: 'OWASP Top 10 for Agentic Applications',
    href: 'https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/',
  },
];

const wrap = 'mx-auto w-full max-w-[1240px] px-4 lg:px-8';
const h2 = 'text-[30px] leading-[1.1] font-extrabold sm:text-[38px]';

export interface Recorded {
  recordedAt: string;
  branchId: string;
  view: RunView;
  events: AuditEvent[];
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="eyebrow flex items-center gap-3">
      <span className="bg-accent h-0.5 w-[18px]" aria-hidden />
      {children}
    </div>
  );
}

function Hero({
  record,
  picked,
  onPick,
}: {
  record: Recorded;
  picked: string;
  onPick: (id: string) => void;
}) {
  const { view } = record;
  const state = view.snapshot.state;
  const due = state.invoices.reduce((sum, item) => sum + item.amountCents - item.paidCents, 0);
  const gap = due - state.cashCents;
  const branch = view.branches.find((item) => item.id === picked) ?? view.branches[0]!;
  const approvals = branch.risk?.approvalsNeeded ?? 0;

  return (
    <section className="bg-panel text-panel-text relative overflow-hidden">
      {/* faint rings, the only decoration on the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-[250px] -right-[140px] h-[650px] w-[650px] rounded-full border border-[color-mix(in_srgb,var(--bright)_9%,transparent)] shadow-[0_0_0_110px_color-mix(in_srgb,var(--bright)_2%,transparent),0_0_0_220px_color-mix(in_srgb,var(--bright)_1%,transparent)]"
      />
      <div
        className={`${wrap} relative grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24`}
      >
        <div>
          <div className="text-bright text-[11px] font-extrabold tracking-[0.14em] uppercase">
            Execution harness for autonomous agents
          </div>
          <h1 className="mt-5 text-[44px] leading-[1.02] font-extrabold tracking-[-0.045em] sm:text-[60px] xl:text-[72px]">
            Explore every outcome. <span className="text-bright">Commit only one.</span>
          </h1>
          <p className="text-panel-muted mt-6 max-w-[48ch] text-[16px] leading-[1.75]">
            An AI agent can find many ways forward. Fork lets it try each one on a copy of the
            books, puts the trade-offs in front of you, and holds execution to the one plan you
            approve.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <Link
              href="/proof"
              className="bg-bright inline-flex h-11 items-center gap-2 rounded-[8px] px-5 text-[14px] font-extrabold text-[#133025] hover:opacity-90"
            >
              See the proof <ArrowUpRight size={16} strokeWidth={2.25} aria-hidden />
            </Link>
            <Link
              href="/app"
              className="border-panel-line hover:bg-panel-raised inline-flex h-11 items-center gap-2 rounded-[8px] border px-5 text-[14px] font-extrabold"
            >
              Open the decision studio <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
            </Link>
          </div>
          <p className="text-panel-muted mt-6 text-[12px] font-semibold">
            Several possible futures · One clear decision · Every action accounted for
          </p>
        </div>

        <div className="border-panel-line bg-panel-raised rounded-[16px] border p-5 shadow-[0_25px_60px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-panel-muted text-[11px] font-extrabold tracking-[0.11em] uppercase">
              A decision, recorded
            </span>
            <span className="border-panel-line text-bright rounded-[6px] border px-2 py-0.5 text-[11px] font-bold">
              Sandbox
            </span>
          </div>

          <div className="border-panel-line bg-panel mt-4 grid grid-cols-3 rounded-[10px] border">
            {(
              [
                ['Cash available', usdShort(state.cashCents), ''],
                ['Bills due', usdShort(due), ''],
                ['Shortfall', gap > 0 ? `−${usdShort(gap)}` : usdShort(0), 'text-warm'],
              ] as const
            ).map(([name, value, tone]) => (
              <div key={name} className="border-panel-line border-l p-3 first:border-0">
                <div className="text-panel-muted text-[11px]">{name}</div>
                <div className={`figure mt-1 text-[17px] sm:text-[20px] ${tone}`}>{value}</div>
              </div>
            ))}
          </div>

          <div className="text-panel-muted mt-4 mb-2 text-[11px] font-extrabold tracking-[0.11em] uppercase">
            {view.branches.length} routes the agent proposed
          </div>
          <div className="flex flex-col gap-2">
            {view.branches.map((item) => {
              const selected = item.id === branch.id;
              const p = item.projection;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPick(item.id)}
                  className={`flex items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left ${
                    selected
                      ? 'border-bright bg-[color-mix(in_srgb,var(--bright)_16%,var(--panel-raised))]'
                      : 'border-panel-line bg-[color-mix(in_srgb,var(--bright)_5%,var(--panel-raised))] hover:border-[color-mix(in_srgb,var(--bright)_50%,var(--panel-line))]'
                  }`}
                >
                  <span className="border-panel-line text-bright flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border text-[13px] font-extrabold">
                    {item.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{item.title}</span>
                    <span className="text-panel-muted block text-[12px]">
                      {p
                        ? `${usdShort(p.outflowCents)} paid · ${usdShort(p.deferredCents)} deferred`
                        : 'Not simulated'}
                    </span>
                  </span>
                  {p ? (
                    <span
                      className={`figure text-[14px] ${p.cashAfterCents < 0 ? 'text-warm' : 'text-bright'}`}
                    >
                      {usdShort(p.cashAfterCents)} left
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <dl
            aria-live="polite"
            className="border-panel-line mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 border-t pt-4 text-[13px]"
          >
            <dt className="text-panel-muted">Plan {branch.label}</dt>
            <dd className="font-bold">{branch.title}</dd>
            <dt className="text-panel-muted">Late fees</dt>
            <dd className="money">{usd(branch.projection?.lateFeesCents ?? 0)}</dd>
            <dt className="text-panel-muted">Needs sign-off</dt>
            <dd>
              {approvals} {approvals === 1 ? 'payment' : 'payments'}
            </dd>
            <dt className="text-panel-muted">Outcome</dt>
            <dd>{statusText(branch.status)}</dd>
          </dl>
          <p className="text-panel-muted mt-3 flex items-start gap-2 text-[12px]">
            <Check
              size={14}
              strokeWidth={2.5}
              className="text-bright mt-0.5 shrink-0"
              aria-hidden
            />
            Recorded from a real run on {record.recordedAt.slice(0, 10)}. Pick a route to read its
            numbers.
          </p>
        </div>
      </div>
    </section>
  );
}

const IDEA: [string, string][] = [
  [
    'Explore possibilities',
    'The agent proposes different ways to solve the problem. Each one runs against a frozen copy of the books, never the real ledger.',
  ],
  [
    'Choose with the numbers in front of you',
    "Compare what gets paid, what waits, and what each plan costs. FORK calculates this itself; the agent's claims are not trusted.",
  ],
  [
    'Keep execution honest',
    'Your approval freezes the exact payments. ArmorIQ checks every tool call against them, and anything else is refused before money moves.',
  ],
];

function Idea() {
  return (
    <section
      id="how"
      className="border-line grid grid-cols-1 gap-10 border-b py-16 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16"
    >
      <div>
        <SectionEyebrow>The idea</SectionEyebrow>
        <h2 className={`${h2} mt-3`}>
          Powerful agents.
          <br />
          Clear boundaries.
        </h2>
        <p className="text-muted mt-4 max-w-[44ch] text-[15px] leading-[1.8]">
          A good agent can discover options. Deciding which one is acceptable should not be buried
          in an opaque tool call. Fork puts the choice, and its consequences, in front of a person.
        </p>
        <Link href="/how" className={`${buttonClass('secondary')} mt-6`}>
          See what is under the hood <ArrowRight size={15} strokeWidth={2} aria-hidden />
        </Link>
      </div>
      <ol className="grid gap-2.5">
        {IDEA.map(([name, text], i) => (
          <li key={name} className="card grid grid-cols-[34px_1fr] gap-4 p-5">
            <span className="bg-mint text-accent flex h-[30px] w-[30px] items-center justify-center rounded-[8px] font-mono text-[13px] font-semibold">
              0{i + 1}
            </span>
            <div>
              <h3 className="text-[16px] font-extrabold">{name}</h3>
              <p className="text-muted mt-1 text-[13px] leading-relaxed">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BranchMap({
  record,
  picked,
  onPick,
}: {
  record: Recorded;
  picked: string;
  onPick: (id: string) => void;
}) {
  const { view } = record;
  const branches = useMemo(() => view.branches, [view]);
  const steps = useMemo(() => view.steps, [view]);
  return (
    <section className="border-line border-b py-16">
      <SectionEyebrow>The same decision, as a tree</SectionEyebrow>
      <h2 className={`${h2} mt-3 max-w-[20ch]`}>Every plan forks from one snapshot.</h2>
      <p className="text-muted mt-4 max-w-[62ch] text-[15px] leading-[1.8]">
        All branches start from the same frozen balance, so they can be compared fairly. Only the
        approved branch is ever executed. Refused attempts hang off it as dead ends.
      </p>
      <div className="card mt-7 h-[460px] overflow-hidden">
        <BranchCanvas
          branches={branches}
          steps={steps}
          cashCents={view.snapshot.state.cashCents}
          selectedId={picked}
          onSelect={onPick}
        />
      </div>
    </section>
  );
}

function Evidence({ record }: { record: Recorded }) {
  const { view } = record;
  const message = view.messages.at(-1);
  const attempts = view.steps.filter((step) => step.origin === 'agent');
  const execution = view.executions.find((item) => item.kind === 'commit');
  const vendorName = (id: unknown) =>
    view.snapshot.state.vendors.find((item) => item.id === id)?.name ?? String(id ?? '');
  return (
    <section id="evidence" className="py-16">
      <div className="bg-mint grid grid-cols-1 items-start gap-9 rounded-[16px] border border-[color-mix(in_srgb,var(--accent)_22%,var(--mint))] p-6 lg:grid-cols-2 lg:p-9">
        <div>
          <SectionEyebrow>The moment that matters</SectionEyebrow>
          <h2 className="mt-3 text-[28px] leading-[1.12] font-extrabold sm:text-[32px]">
            What happens when an agent changes its mind?
          </h2>
          <p className="mt-4 text-[14px] leading-[1.85]">
            Midway through execution, a fake vendor email arrived asking to redirect a payment. The
            inbox agent, a real model, believed it and tried. That instruction was never approved,
            so the attempt was refused and recorded.
          </p>
          <p className="text-muted mt-3 text-[13px] leading-[1.8]">
            ArmorIQ binds the tool to the signed plan, so the change of bank details was blocked
            outright. The altered payment got past ArmorIQ and was stopped by FORK&apos;s own
            payment server, which accepts only the single-use capability minted for an approved
            payment.
          </p>
          <Link href="/proof" className={`${buttonClass('primary')} mt-6`}>
            Run the proof yourself <ArrowUpRight size={15} strokeWidth={2} aria-hidden />
          </Link>
        </div>

        <div className="card p-5">
          <div className="label">Recorded from that run, not edited</div>
          {message ? (
            <div className="border-line mt-3 flex gap-3 border-b pb-4">
              <Mail
                size={17}
                strokeWidth={1.75}
                className="text-muted mt-0.5 shrink-0"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="text">UNTRUSTED INPUT</Chip>
                  <span className="text-muted font-mono text-[11px] break-all">{message.from}</span>
                </div>
                <p className="mt-1.5 text-[14px] font-bold">{message.subject}</p>
                <p className="text-muted mt-1 line-clamp-4 text-[13px] leading-relaxed">
                  {message.body}
                </p>
              </div>
            </div>
          ) : null}
          <ol>
            {attempts.map((step) => {
              const told = describeStep(step, vendorName);
              return (
                <li key={step.id} className="border-line flex gap-3 border-b py-4">
                  <Ban
                    size={17}
                    strokeWidth={2}
                    className={`mt-0.5 shrink-0 ${step.source === 'armoriq' ? 'text-block' : 'text-fork-reject'}`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold">{told.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                      <SourcePill source="agent" />
                      <span className="font-mono">{step.tool}</span>
                      <VerdictPill verdict={step.verdict} />
                      <span className="text-muted font-mono">{step.errorClass}</span>
                      <span className="text-muted font-mono">{clock(step.at)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex items-start gap-3 pt-4 text-[14px] font-bold">
            <Check size={17} strokeWidth={2.5} className="text-allow mt-0.5 shrink-0" aria-hidden />
            The approved plan stayed exactly as signed.
          </div>
          {execution ? (
            <dl className="text-muted mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-[12px]">
              <dt>ArmorIQ plan</dt>
              <dd className="font-mono break-all">{execution.armorPlanId}</dd>
              <dt>Plan hash</dt>
              <dd>
                <HashChip value={execution.armorPlanHash} label="ArmorIQ plan hash" />
              </dd>
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const GATES: [string, string, boolean][] = [
  ['Agent proposal', 'The planner. Untrusted.', false],
  ['Snapshot', 'FORK. A frozen copy of the books.', false],
  ['CFO approval', 'A person. One immutable plan.', true],
  ['ArmorIQ', 'Signed plan plus policy, on every call.', true],
  ['Payment server', 'Checks the single-use capability and the cash.', false],
  ['Ledger receipt', 'Append-only. The only proof of payment.', false],
];

function TwoGates() {
  return (
    <section className="border-line border-t py-16">
      <SectionEyebrow>Two gates</SectionEyebrow>
      <h2 className={`${h2} mt-3`}>Both must open before money moves.</h2>
      <p className="text-muted mt-4 max-w-[64ch] text-[15px] leading-[1.8]">
        A person approving a plan is one gate. ArmorIQ checking each call against that plan is the
        other. The payment server then checks once more.
      </p>
      <ol className="mt-7 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {GATES.map(([name, owner, gate], i) => (
          <li
            key={name}
            className={`card p-4 ${gate ? 'border-accent bg-mint shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}
          >
            <div className="text-muted font-mono text-[11px] font-semibold">0{i + 1}</div>
            <div className="mt-1.5 text-[14px] font-extrabold">{name}</div>
            <div className="text-muted mt-1 text-[12px] leading-relaxed">{owner}</div>
            {gate ? (
              <div className="mt-2">
                <Tag tone="accent">Gate</Tag>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Landing({ record }: { record: Recorded }) {
  const [picked, setPicked] = useState(record.branchId);
  const pick = useCallback((id: string) => setPicked(id), []);
  return (
    <Shell active="Overview">
      <main>
        <Hero record={record} picked={picked} onPick={pick} />
        <div className={wrap}>
          <Idea />
          <BranchMap record={record} picked={picked} onPick={pick} />
          <Evidence record={record} />
          <TwoGates />
          <section className="border-line border-t py-16">
            <SectionEyebrow>Why this matters</SectionEyebrow>
            <p className="mt-4 max-w-[30ch] text-[26px] leading-[1.25] font-extrabold tracking-[-0.03em] sm:text-[30px]">
              <span className="text-accent">$3.05 billion</span> was reported lost to business email
              compromise in 2025.
            </p>
            <p className="text-muted mt-4 max-w-[62ch] text-[14px] leading-[1.8]">
              A message claiming a vendor changed its bank details is exactly that fraud. The FBI
              ranks it the second-largest fraud category by loss. An agent that reads email and
              moves money needs a boundary it cannot talk its way past.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              {PAIN_POINTS.map((point) => (
                <li key={point.href} className="border-line rounded-[10px] border p-4">
                  <p className="text-[13px] leading-[1.6]">{point.text}</p>
                  <a
                    href={point.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted mt-2 block text-[12px] underline underline-offset-2"
                  >
                    {point.source}
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-muted mt-5 text-[12px]">
              Source:{' '}
              <a href={IC3_REPORT} className="underline underline-offset-2">
                FBI Internet Crime Complaint Center, 2025 Internet Crime Report
              </a>
              .{' '}
              {REPO ? (
                <a href={REPO} className="underline underline-offset-2">
                  Source code on GitHub
                </a>
              ) : null}
            </p>
            <p className="text-muted mt-1 text-[12px]">Built for ArmorIQ Flow State 2026.</p>
          </section>
        </div>
      </main>
    </Shell>
  );
}
