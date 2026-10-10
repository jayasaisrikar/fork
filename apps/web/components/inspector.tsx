'use client';

import { Dialog } from 'radix-ui';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { clock, usd, usdShort } from '@/lib/format';
import type { Branch, RunView, Scenario, Step } from '@/lib/types';
import { statusOf } from '@/lib/describe';
import { AuthorizationSeal } from './branch-card';
import { Button, Field, HashChip, Insight, SourcePill, Tag, VerdictPill } from './primitives';

const ARMORIQ_HELD = 'https://platform.armoriq.ai';

interface PlannedPayment {
  tool: string;
  vendor: string;
  recipientId: string;
  amountCents: number;
  status?: string;
}

// before authorization this is a preview from the allocations. after, it is the frozen steps.
export function payments(branch: Branch, scenario: Scenario, view: RunView): PlannedPayment[] {
  const frozen = view.actions.filter(
    (action) => action.branchId === branch.id && action.kind === 'write',
  );
  const name = (vendorId: string) =>
    scenario.vendors.find((item) => item.id === vendorId)?.name ?? vendorId;
  if (frozen.length) {
    return frozen.map((action) => ({
      tool: action.tool,
      vendor: name(String(action.args.vendorId)),
      recipientId: String(action.args.recipientId),
      amountCents: Number(action.args.amountCents),
      status: view.steps.find(
        (step) =>
          step.branchId === branch.id &&
          step.origin === 'runner' &&
          step.stepIndex === action.stepIndex,
      )?.status,
    }));
  }
  const base = view.snapshot.state;
  return branch.actions
    .filter((action) => action.payCents > 0)
    .map((action) => {
      const invoice = base.invoices.find((item) => item.id === action.invoiceId);
      const vendor = base.vendors.find((item) => item.id === invoice?.vendorId);
      return {
        tool: action.payCents > base.holdAboveCents ? 'execute_large_payment' : 'execute_payment',
        vendor: vendor?.name ?? action.invoiceId,
        recipientId: vendor?.recipientId ?? '',
        amountCents: action.payCents,
      };
    });
}

function StepList({ items }: { items: PlannedPayment[] }) {
  return (
    <ol className="border-line divide-line divide-y rounded-[9px] border text-[13px]">
      {items.map((item, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <div className="truncate font-bold">{item.vendor}</div>
            <div className="text-muted truncate font-mono text-[11px]">
              {item.tool} → {item.recipientId}
            </div>
          </div>
          <div className="text-right">
            <div className="money">{usd(item.amountCents)}</div>
            {item.status ? (
              <div className="text-muted text-[11px]">
                {item.status.toLowerCase().replace('_', ' ')}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AuthorizeDialog({
  branch,
  items,
  onConfirm,
  busy,
}: {
  branch: Branch;
  items: PlannedPayment[];
  onConfirm: () => Promise<unknown>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((sum, item) => sum + item.amountCents, 0);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="primary" className="w-full">
          Approve plan {branch.label}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content className="border-line bg-surface text-text fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[16px] border p-6 shadow-2xl">
          <div className="eyebrow">Approval check</div>
          <Dialog.Title className="mt-2 text-[24px] leading-tight font-extrabold">
            Approve plan {branch.label}?
          </Dialog.Title>
          <Dialog.Description className="text-muted mt-2 text-[13px] leading-relaxed">
            You are approving exactly these {items.length} payments, totalling{' '}
            <span className="money text-text font-medium">{usd(total)}</span>. They are frozen when
            you confirm. Anything else the agent tries will be refused.
          </Dialog.Description>
          <div className="mt-4 min-h-0 flex-1 overflow-auto">
            <StepList items={items} />
          </div>
          <p className="text-muted mt-3 text-[12px]">
            Approving does not move money. That happens when you execute the plan.
          </p>
          <div className="mt-4 flex gap-2">
            <Dialog.Close asChild>
              <Button className="flex-1">Not yet</Button>
            </Dialog.Close>
            <Button
              variant="primary"
              className="flex-1"
              disabled={busy}
              onClick={async () => {
                await onConfirm();
                setOpen(false);
              }}
            >
              Approve {items.length} payments
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  if (left === 0) return <span className="text-muted font-mono">expired</span>;
  return (
    <span className="font-mono">
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </span>
  );
}

function HeldCard({ step, scenario }: { step: Step; scenario: Scenario }) {
  const vendor =
    scenario.vendors.find((item) => item.id === step.args.vendorId)?.name ??
    String(step.args.vendorId);
  return (
    <Insight tone="gold">
      <div className="flex items-center gap-2" role="status">
        <VerdictPill verdict={step.verdict} />
        <span className="font-extrabold">Waiting for approval in ArmorIQ</span>
      </div>
      <dl className="mt-1">
        <Field name="Vendor">{vendor}</Field>
        <Field name="Amount">
          <span className="money">{usd(Number(step.args.amountCents ?? 0))}</span>
        </Field>
        <Field name="Delegation">
          {step.delegationId ? (
            <HashChip value={step.delegationId} label="delegation id" />
          ) : (
            <span className="text-muted">opening…</span>
          )}
        </Field>
        <Field name="Held since">
          <span className="font-mono">{clock(step.at)}</span>
        </Field>
      </dl>
      <a
        href={ARMORIQ_HELD}
        target="_blank"
        rel="noreferrer"
        className="text-accent mt-2 inline-flex items-center gap-1 font-bold underline underline-offset-2"
      >
        Review in ArmorIQ <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
      </a>
      <p className="text-muted mt-1.5 text-[12px]">
        FORK cannot approve this. Only a person on the ArmorIQ platform can.
      </p>
    </Insight>
  );
}

const STEPS: [string, string][] = [
  ['Explore', 'The agent drafts a few plans. FORK runs the numbers on a copy of the books.'],
  ['Approve', 'You pick one. Its exact payments are frozen and hashed.'],
  ['Execute', 'Each payment goes through ArmorIQ. Anything off-plan is refused.'],
  ['Review', 'A receipt shows what was paid, what was stopped, and proof of both.'],
];

function HowItGoes() {
  return (
    <>
      <div className="eyebrow">How this goes</div>
      <ol className="mt-3 space-y-3">
        {STEPS.map(([name, text], i) => (
          <li key={name} className="grid grid-cols-[28px_1fr] gap-3">
            <span className="bg-mint text-accent flex h-7 w-7 items-center justify-center rounded-[7px] font-mono text-[12px] font-semibold">
              {i + 1}
            </span>
            <div>
              <div className="text-[13px] font-extrabold">{name}</div>
              <p className="text-muted text-[12px] leading-relaxed">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

// the right-hand panel: the selected plan's numbers, the one next action, and the proof
export function DecisionPanel({
  branch,
  scenario,
  view,
  action,
  hint,
}: {
  branch: Branch | null;
  scenario: Scenario;
  view: RunView | null;
  // the single primary button for the current step, or nothing on a phone
  action: ReactNode;
  hint: string;
}) {
  if (!branch || !view) {
    return (
      <aside className="card h-fit min-w-0 p-5 lg:sticky lg:top-20">
        <HowItGoes />
        {action ? <div className="mt-5">{action}</div> : null}
      </aside>
    );
  }
  const items = payments(branch, scenario, view);
  const approval = view.approvals.find((item) => item.branchId === branch.id && !item.revokedAt);
  const execution = [...view.executions]
    .reverse()
    .find((item) => item.branchId === branch.id && item.kind === 'commit');
  const held = view.steps.find((step) => step.branchId === branch.id && step.status === 'HELD');
  const p = branch.projection;
  const risk = branch.risk;
  const status = statusOf(branch.status);
  const infeasible = branch.feasibility && !branch.feasibility.ok;
  const reads = view.actions.filter(
    (item) => item.branchId === branch.id && item.kind === 'read',
  ).length;

  return (
    <aside className="card h-fit min-w-0 p-5 lg:sticky lg:top-20" aria-label="Selected plan">
      <div className="eyebrow">Your selected plan</div>
      <h2 className="mt-2 text-[22px] leading-tight font-extrabold">
        Plan {branch.label} · {branch.title}
      </h2>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Tag tone={status.tone}>{status.text}</Tag>
        <SourcePill source={branch.source} />
      </div>

      {p ? (
        <dl className="mt-3">
          <Field name="Cash after payments">
            <span className={`money ${p.cashAfterCents < 0 ? 'text-block' : ''}`}>
              {usdShort(p.cashAfterCents)}
            </span>
          </Field>
          <Field name="Paying now">
            <span className="money">{usdShort(p.outflowCents)}</span>
          </Field>
          <Field name="Bills deferred">
            <span className="money">{usdShort(p.deferredCents)}</span>
          </Field>
          <Field name="Estimated late fees">
            <span className="money">{usdShort(p.lateFeesCents)}</span>
          </Field>
          <Field name="Needs extra sign-off">
            {risk?.approvalsNeeded ?? 0} payment{risk?.approvalsNeeded === 1 ? '' : 's'}
          </Field>
          <Field name="Vendors still owed">{risk?.vendorsWithBalance.length ?? 0}</Field>
        </dl>
      ) : (
        <p className="text-muted mt-3 text-[13px]">The numbers for this plan have not been run.</p>
      )}

      <div className="mt-4 space-y-2.5">
        {infeasible ? (
          <Insight tone="purple">
            <b>Rejected by FORK. This plan is not possible.</b>
            <ul className="mt-1 list-disc pl-4">
              {p && p.cashAfterCents < 0 ? (
                <li>Overdraws the account by {usd(-p.cashAfterCents)}.</li>
              ) : null}
              {p?.reserveBreached ? (
                <li>
                  Leaves cash {usd(scenario.reserveCents - p.cashAfterCents)} below the minimum
                  reserve.
                </li>
              ) : null}
            </ul>
            <p className="text-muted mt-1 text-[12px]">
              This is FORK&apos;s own check, before ArmorIQ is ever asked.
            </p>
          </Insight>
        ) : p ? (
          <Insight tone="good">
            <b>Reserve protected.</b> Cash stays at or above {usdShort(scenario.reserveCents)}.
          </Insight>
        ) : null}
        {risk?.criticalDeferred.length ? (
          <Insight tone="gold">
            <b>Critical invoices left unpaid:</b> {risk.criticalDeferred.join(', ')}.
          </Insight>
        ) : null}
        {held ? <HeldCard step={held} scenario={scenario} /> : null}
      </div>

      {action ? <div className="mt-5">{action}</div> : null}
      <p className="text-muted mt-3 text-[12px] leading-relaxed">{hint}</p>

      {approval && branch.approvedPlanHash ? (
        <div className="border-accent bg-mint mt-4 rounded-[10px] border p-3.5">
          <AuthorizationSeal hash={branch.approvedPlanHash} />
          <dl className="mt-2">
            <Field name="Approved plan">
              <HashChip value={branch.approvedPlanHash} label="approved plan hash" />
            </Field>
            {execution ? (
              <>
                <Field name="ArmorIQ plan">
                  <HashChip value={execution.armorPlanHash} label="ArmorIQ plan hash" />
                </Field>
                <Field name="Merkle root">
                  <HashChip value={execution.merkleRoot} label="Merkle root" />
                </Field>
                <Field name="Token">
                  <HashChip value={execution.tokenId} label="token id" />
                </Field>
                <Field name="Token expires in">
                  <Countdown until={execution.expiresAt} />
                </Field>
              </>
            ) : (
              <Field name="ArmorIQ plan">
                <span className="text-muted font-normal">Signed when execution starts</span>
              </Field>
            )}
            <Field name="Approver">{approval.actor}</Field>
            <Field name="Time">
              <span className="font-mono">{clock(approval.at)}</span>
            </Field>
          </dl>
        </div>
      ) : null}

      <details className="border-line mt-4 border-t pt-3" open={Boolean(branch.approvedPlanHash)}>
        <summary className="flex items-center justify-between text-[13px] font-extrabold">
          {branch.approvedPlanHash ? 'Approved payments' : 'Payments this plan would make'} (
          {items.length})
        </summary>
        <div className="mt-2.5">
          {items.length ? (
            <StepList items={items} />
          ) : (
            <p className="text-muted text-[13px]">This plan pays nothing.</p>
          )}
          {reads ? (
            <p className="text-muted mt-1.5 text-[12px]">
              Plus {reads} read-only calls (balance and inbox).
            </p>
          ) : null}
        </div>
      </details>

      <details className="border-line mt-3 border-t pt-3">
        <summary className="text-[13px] font-extrabold">Why the agent suggested this</summary>
        <p className="mt-2 text-[13px] leading-relaxed">{branch.rationale}</p>
        <p className="text-muted mt-1 text-[12px]">
          The agent&apos;s own words, not verified. The numbers above are FORK&apos;s.
        </p>
      </details>
    </aside>
  );
}
