'use client';

import { BRANCH_NEXT, type BranchStatus } from '@fork/harness/lifecycle';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Shell } from '@/components/chrome';
import { Field, Insight, Tag } from '@/components/primitives';
import { statusOf } from '@/lib/describe';
import { labDomains, type LabBranch, type LabDomain } from '@/lib/lab';

const METHODS: [string, string, string][] = [
  ['validateActions', 'Known invoices and approved vendors', 'Known holdings, one trade each'],
  ['simulate', 'Cash, late fees and the 14-day path', 'Positions, weights and cash'],
  ['feasibility', 'No overdraft, reserve kept', 'No overselling, limit and minimum cash kept'],
  ['diff', 'What each invoice is left owing', 'Which positions change'],
  ['toToolSteps', 'The exact MCP calls ArmorIQ signs', 'None, so nothing can run'],
  ['verifyPostcondition', 'Cash moved by what the receipts say', 'Nothing moved at all'],
];

// the states a dry run can reach. the rest need an approval and a signer.
const DRY: BranchStatus[] = ['PROPOSED', 'SIMULATED', 'INFEASIBLE'];

function BranchButton({
  branch,
  selected,
  onSelect,
}: {
  branch: LabBranch;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = statusOf(branch.status);
  const rejected = branch.status === 'INFEASIBLE';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex h-full w-full flex-col gap-2 rounded-[12px] border-[1.5px] p-4 text-left transition-colors ${
        selected
          ? 'border-accent bg-mint shadow-[inset_0_0_0_1px_var(--accent)]'
          : 'border-line bg-surface hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]'
      } ${rejected && !selected ? 'hatch' : ''}`}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="border-line bg-surface mr-auto flex h-7 min-w-7 items-center justify-center rounded-[6px] border px-1.5 text-[13px] font-extrabold">
          {branch.label}
        </span>
        <Tag tone={status.tone}>{status.text}</Tag>
      </span>
      <span className="mt-1 text-[15px] leading-snug font-extrabold">{branch.title}</span>
      <span className="text-muted text-[12px] leading-relaxed">{branch.rationale}</span>
      <span className="mt-auto flex items-baseline gap-2 pt-2">
        <span className="figure text-[26px]">{branch.figure}</span>
        <span className="text-muted text-[12px]">{branch.figureName}</span>
      </span>
      <span className="border-line text-muted flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t pt-2.5 text-[12px]">
        {branch.stats.map((stat) => (
          <span key={stat}>{stat}</span>
        ))}
      </span>
    </button>
  );
}

function Signed({ domain, branch }: { domain: LabDomain; branch: LabBranch }) {
  if (branch.status === 'INFEASIBLE') {
    return (
      <Insight tone="purple">
        <b>Rejected by FORK.</b> It can never be approved, so there is nothing to sign.
        <ul className="mt-1.5 list-disc pl-5">
          {branch.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </Insight>
    );
  }
  if (!branch.steps.length) {
    return (
      <Insight tone="good">
        <b>0 tool steps.</b> <span className="font-mono text-[12px]">{domain.adapter}</span> has no
        tools, so an approval would have nothing to sign and the runner nothing to run. This domain
        stops at the comparison.
      </Insight>
    );
  }
  const writes = branch.steps.filter((step) => step.kind === 'write').length;
  return (
    <>
      <p className="text-[13px] leading-relaxed">
        <b>{branch.steps.length} tool steps</b>, {writes} of them payments. In the studio the CFO
        approves these, ArmorIQ signs them, and nothing else can run.
      </p>
      <ol className="border-line mt-3 rounded-[10px] border">
        {branch.steps.map((step, i) => (
          <li
            key={i}
            className="border-line flex items-center justify-between gap-3 border-b px-3 py-2 last:border-0"
          >
            <span className="font-mono text-[12px]">{step.tool}</span>
            <span className="text-muted text-[12px]">{step.kind}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export default function LabPage() {
  const domains = useMemo(labDomains, []);
  const [domainId, setDomainId] = useState<LabDomain['id']>('portfolio');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const domain = domains.find((item) => item.id === domainId)!;
  const branch =
    domain.branches.find((item) => item.label === picked[domain.id]) ??
    domain.branches.find((item) => item.status === 'SIMULATED')!;

  return (
    <Shell active="Lab">
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-10 lg:px-8">
        <div className="eyebrow">Harness lab</div>
        <h1 className="mt-3 max-w-[18ch] text-[34px] leading-[1.08] font-extrabold sm:text-[44px]">
          One harness. Two domains.
        </h1>
        <p className="text-muted mt-3 max-w-[66ch] text-[15px] leading-relaxed">
          The studio is treasury. This page runs the same fork, simulate and reject path over a
          second domain that was never given a way to act. It runs in your browser on fixture data:
          no model, no ArmorIQ call, nothing written.
        </p>

        <section className="card mt-8 p-5 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[20px] font-extrabold">Fork a decision</h2>
              <p className="text-muted mt-1.5 text-[13px]">
                Starting point: <span className="text-text">{domain.base}</span>.
              </p>
            </div>
            <div role="group" aria-label="Domain" className="flex gap-2">
              {domains.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === domain.id}
                  onClick={() => setDomainId(item.id)}
                  className={`flex h-10 items-center gap-2 rounded-[8px] border px-3.5 text-[13px] font-bold ${
                    item.id === domain.id
                      ? 'bg-ink text-on-ink border-ink'
                      : 'bg-surface text-text border-line hover:bg-raised'
                  }`}
                >
                  {item.name}
                  <span className="font-mono text-[11px] font-medium opacity-80">{item.mode}</span>
                </button>
              ))}
            </div>
          </div>

          <ul className="mt-5 grid grid-cols-1 gap-2 md:grid-cols-3" aria-label="Branches">
            {domain.branches.map((item) => (
              <li key={item.label}>
                <BranchButton
                  branch={item}
                  selected={item.label === branch.label}
                  onSelect={() => setPicked({ ...picked, [domain.id]: item.label })}
                />
              </li>
            ))}
          </ul>

          <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <h3 className="text-[15px] font-extrabold">What branch {branch.label} changes</h3>
              <div
                role="region"
                aria-label={`Branch ${branch.label} changes`}
                tabIndex={0}
                className="border-line mt-3 overflow-x-auto rounded-[10px] border"
              >
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-line border-b">
                      {domain.columns.map((column, i) => (
                        <th
                          key={column}
                          scope="col"
                          className={`label px-3 py-2.5 ${i ? 'text-right' : 'text-left'}`}
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {branch.rows.map(([name, ...cells]) => (
                      <tr key={name} className="border-line border-b last:border-0">
                        <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                          {name}
                        </th>
                        {cells.map((cell, i) => (
                          <td key={i} className="money px-3 py-2.5 text-right">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="text-[15px] font-extrabold">What would be signed</h3>
              <div className="mt-3">
                <Signed domain={domain} branch={branch} />
              </div>
            </div>
          </div>
          <p className="text-muted mt-4 text-[12px]">
            Fixture branches through <span className="font-mono">dryRun()</span> in{' '}
            <span className="font-mono">packages/harness/src/dry-run.ts</span> and{' '}
            <span className="font-mono">{domain.source}</span>.
          </p>
        </section>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="card p-5 lg:p-6">
            <h2 className="text-[20px] font-extrabold">Two adapters, one interface</h2>
            <p className="text-muted mt-2 max-w-[62ch] text-[13px] leading-relaxed">
              A domain implements six methods. The harness never looks inside them, which is why
              leaving out the tools is enough to make a domain read-only.{' '}
              <Link href="/how" className="text-accent font-bold underline underline-offset-2">
                See the interface
              </Link>
              .
            </p>
            <div
              role="region"
              aria-label="Adapter methods"
              tabIndex={0}
              className="border-line mt-4 overflow-x-auto rounded-[10px] border"
            >
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="border-line border-b">
                    <th scope="col" className="label px-3 py-2.5 text-left">
                      Method
                    </th>
                    <th scope="col" className="label px-3 py-2.5 text-left">
                      Treasury
                    </th>
                    <th scope="col" className="label px-3 py-2.5 text-left">
                      Portfolio dry run
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {METHODS.map(([method, treasury, portfolio]) => (
                    <tr key={method} className="border-line border-b align-top last:border-0">
                      <th scope="row" className="px-3 py-2.5 text-left font-mono text-[12px]">
                        {method}
                      </th>
                      <td className="px-3 py-2.5">{treasury}</td>
                      <td className="px-3 py-2.5">{portfolio}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3">
              <Field name="Executes through ArmorIQ and the MCP">Treasury only</Field>
              <Field name="Proposed by a model">Treasury only</Field>
            </dl>
          </section>

          <section className="card p-5 lg:p-6">
            <h2 className="text-[20px] font-extrabold">Branch lifecycle</h2>
            <p className="text-muted mt-2 text-[13px] leading-relaxed">
              Drawn from the table the guards check. Any other move throws. A dry run reaches the
              marked states and no further.
            </p>
            <ul className="mt-4 space-y-1.5">
              {(Object.keys(BRANCH_NEXT) as BranchStatus[]).map((from) => (
                <li
                  key={from}
                  className="border-line flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border px-3 py-2"
                >
                  <span className="font-mono text-[12px] font-semibold">{from}</span>
                  {DRY.includes(from) ? <Tag tone="accent">Dry run</Tag> : null}
                  {BRANCH_NEXT[from].length ? (
                    <>
                      <ArrowRight size={13} strokeWidth={2} className="text-muted" aria-hidden />
                      <span className="sr-only">can become</span>
                      <span className="text-muted font-mono text-[12px]">
                        {BRANCH_NEXT[from].join(', ')}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted ml-auto text-[12px]">final</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </Shell>
  );
}
