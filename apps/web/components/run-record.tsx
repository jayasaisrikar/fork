'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { clock, usd } from '@/lib/format';
import type { AuditEvent, Branch, PlannedAction, Projection, RunView, Step } from '@/lib/types';
import { statusText } from './branch-card';
import { Button, Chip, HashChip, Money, SourcePill, VerdictPill } from './primitives';

const th = 'label px-3 py-2 text-left font-normal';
const td = 'px-3 py-2 align-top';
const DIFF_FIELDS = ['vendorId', 'recipientId', 'amountCents'] as const;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line border-t py-6">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      {note ? <p className="text-muted mt-1 max-w-[70ch] text-[13px]">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Table({
  head,
  children,
  min = 640,
}: {
  head: string[];
  children: React.ReactNode;
  min?: number;
}) {
  return (
    <div className="border-line overflow-x-auto rounded-[6px] border">
      <table className="bg-surface w-full border-collapse text-[13px]" style={{ minWidth: min }}>
        <thead>
          <tr className="border-line border-b">
            {head.map((name) => (
              <th key={name} className={`${th} ${name === 'Amount' ? 'text-right' : ''}`}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-line [&>tr]:border-b [&>tr:last-child]:border-0">
          {children}
        </tbody>
      </table>
    </div>
  );
}

const amountOf = (args: Record<string, unknown>) =>
  args.amountCents ? <span className="money">{usd(Number(args.amountCents))}</span> : null;

// the approved step an attempt should be measured against: same tool and vendor, else same tool
function approvedFor(step: Step, actions: PlannedAction[]): PlannedAction | undefined {
  if (step.origin === 'runner')
    return actions.find((action) => action.stepIndex === step.stepIndex);
  return (
    actions.find(
      (action) => action.tool === step.tool && action.args.vendorId === step.args.vendorId,
    ) ?? actions.find((action) => action.tool === step.tool)
  );
}

function whatTriggered(step: Step, view: RunView): string {
  if (step.origin === 'tamper_test') return 'A deliberate security test, started by the CFO.';
  if (step.origin === 'agent') {
    const message = view.messages.at(-1);
    return message
      ? `The inbox agent, acting on the message "${message.subject}" from ${message.from}.`
      : 'The inbox agent, acting on an inbox message.';
  }
  return 'The commit runner, on an approved step.';
}

function Replay({ branch }: { branch: Branch }) {
  const [result, setResult] = useState<{
    projection: Projection;
    matchesStored: boolean | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(
            await api('GET', `/api/branches/${branch.id}/replay`).then(
              (value) => value as typeof result,
              () => null,
            ),
          );
          setBusy(false);
        }}
      >
        Replay simulation
      </Button>
      {result ? (
        <p className="mt-2 text-[13px]" role="status">
          Re-evaluated branch {branch.label} against its stored snapshot: cash after{' '}
          <Money cents={result.projection.cashAfterCents} />, late fees{' '}
          <span className="money">{usd(result.projection.lateFeesCents)}</span>.{' '}
          {result.matchesStored
            ? 'It matches the projection the CFO saw.'
            : 'It does not match the stored projection.'}{' '}
          Nothing was written.
        </p>
      ) : null}
    </div>
  );
}

export function RunRecord({
  view,
  events,
  branchId,
  live = true,
}: {
  view: RunView;
  events: AuditEvent[];
  branchId?: string;
  live?: boolean;
}) {
  const branch =
    view.branches.find((item) => item.id === branchId) ??
    view.branches.find((item) =>
      view.executions.some(
        (execution) => execution.branchId === item.id && execution.kind === 'commit',
      ),
    ) ??
    view.branches.find((item) => item.approvedPlanHash) ??
    view.branches[0];
  if (!branch) return <p className="text-muted text-[14px]">This run has no branches yet.</p>;

  const state = view.snapshot.state;
  const vendor = (id: unknown) =>
    state.vendors.find((item) => item.id === id)?.name ?? String(id ?? '');
  const actions = view.actions.filter((action) => action.branchId === branch.id);
  const approval = view.approvals.find((item) => item.branchId === branch.id);
  const execution = view.executions.find(
    (item) => item.branchId === branch.id && item.kind === 'commit',
  );
  const steps = view.steps
    .filter((step) => step.branchId === branch.id)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const refused = steps.filter(
    (step) => step.verdict && step.status === 'NOT_EXECUTED' && step.verdict !== 'hold',
  );
  const held = steps.filter((step) => step.delegationId);
  const receipts = view.receipts.filter((receipt) =>
    steps.some((step) => step.receiptId === receipt.id),
  );
  const totals = view.reconciliation.find((item) => item.branchId === branch.id);

  function exportJson() {
    const blob = new Blob([JSON.stringify({ run: view.run, branch, receipts, steps }, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `fork-run-${view.run.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <article>
      <header className="pb-6">
        <p className="label">Run record</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold">
          Run <span className="font-mono">#{String(view.run.id).padStart(4, '0')}</span>, branch{' '}
          {branch.label}: {branch.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip tone="text">{statusText(branch.status)}</Chip>
          <SourcePill source={branch.source} />
        </div>
        <dl className="mt-4 grid max-w-[720px] grid-cols-[160px_1fr] gap-y-1 text-[13px]">
          <dt className="text-muted">Started</dt>
          <dd className="font-mono">{view.run.createdAt.replace('T', ' ').slice(0, 19)} UTC</dd>
          <dt className="text-muted">Approver</dt>
          <dd>{approval?.actor ?? 'Not authorized'}</dd>
          <dt className="text-muted">Authorized at</dt>
          <dd className="font-mono">
            {approval ? `${approval.at.replace('T', ' ').slice(0, 19)} UTC` : '—'}
          </dd>
          <dt className="text-muted">Approved plan</dt>
          <dd>
            {branch.approvedPlanHash ? (
              <HashChip value={branch.approvedPlanHash} label="approved plan hash" />
            ) : (
              '—'
            )}
          </dd>
        </dl>
      </header>

      <Section
        title="Authorization"
        note="The steps exactly as the CFO signed them. FORK hashes them; ArmorIQ signs the same steps as an intent plan when the commit starts."
      >
        {execution ? (
          <dl className="mb-3 grid max-w-[720px] grid-cols-[160px_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted">ArmorIQ plan</dt>
            <dd className="font-mono text-[12px]">{execution.armorPlanId}</dd>
            <dt className="text-muted">ArmorIQ plan hash</dt>
            <dd>
              <HashChip value={execution.armorPlanHash} label="ArmorIQ plan hash" />
            </dd>
            <dt className="text-muted">Merkle root</dt>
            <dd>
              <HashChip value={execution.merkleRoot} label="Merkle root" />
            </dd>
            <dt className="text-muted">Token</dt>
            <dd>
              <HashChip value={execution.tokenId} label="token id" />
            </dd>
          </dl>
        ) : null}
        {actions.length ? (
          <Table head={['#', 'Tool', 'Vendor', 'Recipient', 'Amount']}>
            {actions.map((action) => (
              <tr key={action.stepIndex}>
                <td className={`${td} text-muted font-mono`}>{action.stepIndex}</td>
                <td className={`${td} font-mono`}>{action.tool}</td>
                <td className={td}>
                  {action.kind === 'write' ? (
                    vendor(action.args.vendorId)
                  ) : (
                    <span className="text-muted">read only</span>
                  )}
                </td>
                <td className={`${td} font-mono`}>{action.args.recipientId ?? ''}</td>
                <td className={`${td} text-right`}>{amountOf(action.args)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-muted text-[13px]">
            This branch was never authorized, so no steps were frozen.
          </p>
        )}
      </Section>

      <Section
        title="Execution"
        note="Each call that was attempted, next to what was approved. A field that differs from the approved step is marked."
      >
        {steps.length ? (
          <Table
            head={[
              'Time',
              'Source',
              'Tool',
              'Attempted',
              'Against the approved step',
              'Verdict',
              'Outcome',
            ]}
            min={920}
          >
            {steps.map((step) => {
              const approved = approvedFor(step, actions);
              const changed = approved
                ? DIFF_FIELDS.filter(
                    (field) =>
                      step.args[field] !== undefined &&
                      String(step.args[field]) !== String(approved.args[field] ?? ''),
                  )
                : [];
              return (
                <tr key={step.id}>
                  <td className={`${td} font-mono whitespace-nowrap`}>{clock(step.at)}</td>
                  <td className={td}>
                    <SourcePill source={step.origin === 'runner' ? 'runner' : step.origin} />
                  </td>
                  <td className={`${td} font-mono`}>{step.tool}</td>
                  <td className={`${td} font-mono text-[12px]`}>
                    {DIFF_FIELDS.filter((field) => step.args[field] !== undefined).map((field) => (
                      <div
                        key={field}
                        className={
                          changed.includes(field)
                            ? 'font-semibold underline decoration-dotted underline-offset-2'
                            : 'text-muted'
                        }
                      >
                        {field}:{' '}
                        {field === 'amountCents'
                          ? usd(Number(step.args[field]))
                          : String(step.args[field])}
                      </div>
                    ))}
                  </td>
                  <td className={`${td} text-[12px]`}>
                    {!approved
                      ? 'Not in the approved plan'
                      : changed.length
                        ? `Differs in ${changed.join(', ')}`
                        : 'As approved'}
                  </td>
                  <td className={td}>
                    <VerdictPill verdict={step.verdict} />
                  </td>
                  <td className={`${td} text-[12px]`}>
                    {step.source === 'mcp' ? (
                      <span className="text-fork-reject">refused by the MCP</span>
                    ) : (
                      step.status.toLowerCase().replace('_', ' ')
                    )}
                    {step.errorClass ? (
                      <div className="text-muted font-mono">{step.errorClass}</div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <p className="text-muted text-[13px]">Nothing was sent to ArmorIQ for this branch.</p>
        )}
      </Section>

      <Section
        title="Refused"
        note="Every attempt that was stopped, who stopped it, and what set it off."
      >
        {refused.length ? (
          <ul className="space-y-3">
            {refused.map((step) => (
              <li key={step.id} className="border-line bg-surface rounded-[6px] border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px]">{step.tool}</span>
                  <VerdictPill verdict={step.verdict} />
                  <span
                    className={`text-[13px] font-medium ${step.source === 'armoriq' ? '' : 'text-fork-reject'}`}
                  >
                    {step.source === 'armoriq'
                      ? 'Blocked by ArmorIQ'
                      : step.source === 'mcp'
                        ? 'Allowed by ArmorIQ, then refused by the MCP'
                        : 'Rejected by FORK'}
                  </span>
                </div>
                <p className="mt-1 text-[13px]">{whatTriggered(step, view)}</p>
                <p className="text-muted mt-1 font-mono text-[12px] break-words">
                  {step.errorClass}
                  {step.message ? `: ${step.message.slice(0, 260)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-[13px]">Nothing was refused.</p>
        )}
      </Section>

      {held.length ? (
        <Section title="Held" note="Payments that waited for a person on the ArmorIQ platform.">
          <Table head={['Tool', 'Vendor', 'Amount', 'Delegation', 'Outcome']}>
            {held.map((step) => (
              <tr key={step.id}>
                <td className={`${td} font-mono`}>{step.tool}</td>
                <td className={td}>{vendor(step.args.vendorId)}</td>
                <td className={`${td} text-right`}>{amountOf(step.args)}</td>
                <td className={td}>
                  {step.delegationId ? (
                    <HashChip value={step.delegationId} label="delegation id" />
                  ) : null}
                </td>
                <td className={td}>
                  {step.status === 'EXECUTED'
                    ? 'Approved, then paid'
                    : step.status === 'HELD'
                      ? 'Still waiting'
                      : 'Not approved, not paid'}
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      ) : null}

      <Section
        title="Receipts"
        note="Committed payments. Cash changes only when the MCP returns one of these."
      >
        {receipts.length ? (
          <>
            <Table head={['Receipt', 'Vendor', 'Recipient', 'Time', 'Amount']}>
              {receipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td className={td}>
                    <HashChip value={receipt.id} label="receipt id" />
                  </td>
                  <td className={td}>{vendor(receipt.vendorId)}</td>
                  <td className={`${td} font-mono`}>{receipt.recipientId}</td>
                  <td className={`${td} font-mono`}>{clock(receipt.at)}</td>
                  <td className={`${td} money text-right`}>{usd(receipt.amountCents)}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-3">
              <Button onClick={exportJson}>Export this record as JSON</Button>
            </div>
          </>
        ) : (
          <p className="text-muted text-[13px]">No payment was committed.</p>
        )}
      </Section>

      {totals ? (
        <Section
          title="Reconciliation"
          note="Three totals from three places. Executed and ledger must always agree. Authorized is higher when the branch stopped short."
        >
          <dl className="border-line bg-surface grid max-w-[520px] grid-cols-[1fr_auto] gap-y-2 rounded-[6px] border p-3 text-[14px]">
            <dt>Authorized by the CFO</dt>
            <dd className="money">{usd(totals.authorizedCents)}</dd>
            <dt>Executed, by receipts</dt>
            <dd
              className={`money ${totals.executedCents !== totals.authorizedCents ? 'text-block' : ''}`}
            >
              {usd(totals.executedCents)}
            </dd>
            <dt>Left the ledger</dt>
            <dd
              className={`money ${totals.ledgerCents !== totals.executedCents ? 'text-block' : ''}`}
            >
              {usd(totals.ledgerCents)}
            </dd>
          </dl>
          <p className="mt-2 text-[13px]">
            {totals.ledgerCents !== totals.executedCents
              ? 'The ledger and the receipts disagree. That should never happen; treat this run as suspect.'
              : totals.executedCents === totals.authorizedCents
                ? 'All three agree. Every approved payment was made, once.'
                : `Receipts and ledger agree. ${usd(totals.authorizedCents - totals.executedCents)} of approved payments was not made because the branch stopped short.`}
          </p>
        </Section>
      ) : null}

      <Section title="Chronology" note="The append-only event log for this run, oldest first.">
        <ol className="border-line bg-surface divide-line divide-y rounded-[6px] border text-[13px]">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
              <span className="text-muted font-mono text-[12px]">{clock(event.at)}</span>
              <SourcePill source={event.source} />
              <span className="font-mono text-[12px]">{event.type}</span>
              {event.payload.tool ? (
                <span className="text-muted font-mono text-[12px]">
                  {String(event.payload.tool)}
                </span>
              ) : null}
              {event.payload.verdict ? (
                <VerdictPill verdict={String(event.payload.verdict)} />
              ) : null}
            </li>
          ))}
        </ol>
      </Section>

      {live ? (
        <Section
          title="Replay simulation"
          note="Re-evaluates the stored branch against the stored snapshot. It reads and computes. It is not a rollback and it changes nothing."
        >
          <Replay branch={branch} />
        </Section>
      ) : null}
    </article>
  );
}
