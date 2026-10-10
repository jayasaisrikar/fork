'use client';

import { Dialog } from 'radix-ui';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { clock, usd } from '@/lib/format';
import type { Branch, RunView, Scenario, Step } from '@/lib/types';
import type { Workspace } from '@/lib/use-workspace';
import { AuthorizationSeal, statusText } from './branch-card';
import { Button, Chip, Field, HashChip, VerdictPill } from './primitives';

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
    <ol className="border-line divide-line divide-y rounded-[4px] border text-[12px]">
      {items.map((item, i) => (
        <li key={i} className="flex items-center justify-between gap-2 px-2 py-1.5">
          <div className="min-w-0">
            <div className="truncate">{item.vendor}</div>
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
  compact,
}: {
  branch: Branch;
  items: PlannedPayment[];
  onConfirm: () => Promise<unknown>;
  busy: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((sum, item) => sum + item.amountCents, 0);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="primary" className={compact ? '' : 'w-full'}>
          Authorize branch {branch.label}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="border-line bg-surface text-text fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[6px] border p-4 shadow-lg">
          <Dialog.Title className="text-[16px] font-semibold">
            Authorize branch {branch.label}
          </Dialog.Title>
          <Dialog.Description className="text-muted mt-1 text-[13px]">
            You are approving exactly these {items.length} payments, totalling{' '}
            <span className="money text-text">{usd(total)}</span>. They are frozen when you confirm.
            Anything else the agent tries will be refused.
          </Dialog.Description>
          <div className="mt-3 min-h-0 flex-1 overflow-auto">
            <StepList items={items} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button>Cancel</Button>
            </Dialog.Close>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                await onConfirm();
                setOpen(false);
              }}
            >
              Authorize {items.length} payments
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
    <div className="border-hold rounded-[6px] border p-3" role="status">
      <div className="flex items-center gap-2">
        <VerdictPill verdict={step.verdict} />
        <span className="text-[13px] font-semibold">Waiting for approval in ArmorIQ</span>
      </div>
      <dl className="mt-2">
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
        className="text-accent mt-2 inline-flex items-center gap-1 text-[13px] font-medium underline underline-offset-2"
      >
        Review in ArmorIQ <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
      </a>
      <p className="text-muted mt-2 text-[12px]">
        FORK cannot approve this. Only a person on the ArmorIQ platform can.
      </p>
    </div>
  );
}

export function Inspector({
  branch,
  scenario,
  view,
  ws,
}: {
  branch: Branch | null;
  scenario: Scenario;
  view: RunView | null;
  ws: Workspace;
}) {
  if (!branch || !view) {
    return <p className="text-muted p-3 text-[13px]">Select a branch to see what it would do.</p>;
  }
  const items = payments(branch, scenario, view);
  const approval = view.approvals.find((item) => item.branchId === branch.id && !item.revokedAt);
  const execution = [...view.executions]
    .reverse()
    .find((item) => item.branchId === branch.id && item.kind === 'commit');
  const held = view.steps.find((step) => step.branchId === branch.id && step.status === 'HELD');
  const risk = branch.risk;
  const reads = view.actions.filter(
    (action) => action.branchId === branch.id && action.kind === 'read',
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-display text-[20px] leading-none font-extrabold">
            {branch.label}
          </span>
          <h3 className="text-[14px] font-semibold">{branch.title}</h3>
        </div>
        <div className="mt-1">
          <Chip>{statusText(branch.status)}</Chip>
        </div>
      </div>

      {held ? <HeldCard step={held} scenario={scenario} /> : null}

      <div>
        <div className="label">Agent rationale, not verified</div>
        <p className="mt-1 text-[13px] leading-relaxed">{branch.rationale}</p>
      </div>

      {branch.feasibility && !branch.feasibility.ok ? (
        <div className="border-fork-reject hatch rounded-[6px] border p-3">
          <div className="text-fork-reject text-[13px] font-semibold">Rejected by FORK</div>
          <p className="text-muted mt-1 text-[12px]">
            This is FORK&apos;s own check, before ArmorIQ is ever asked. It cannot be authorized.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px]">
            {branch.projection && branch.projection.cashAfterCents < 0 ? (
              <li>Overdraws the account by {usd(-branch.projection.cashAfterCents)}.</li>
            ) : null}
            {branch.projection?.reserveBreached ? (
              <li>
                Leaves cash {usd(scenario.reserveCents - branch.projection.cashAfterCents)} below
                the minimum reserve.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {risk ? (
        <div>
          <div className="label">Risk, from FORK&apos;s rules</div>
          <dl className="mt-1">
            <Field name="Reserve">{risk.reserveBreach ? 'Breached' : 'Held'}</Field>
            <Field name="Critical invoices left unpaid">
              {risk.criticalDeferred.length ? risk.criticalDeferred.join(', ') : 'None'}
            </Field>
            <Field name="Late-fee exposure">
              <span className="money">{usd(risk.lateFeeExposureCents)}</span>
            </Field>
            <Field name="Vendors still owed">{risk.vendorsWithBalance.length}</Field>
            <Field name="Payments needing approval">{risk.approvalsNeeded}</Field>
          </dl>
        </div>
      ) : null}

      <div>
        <div className="label mb-1">
          {branch.approvedPlanHash ? 'Authorized payments' : 'Payments this branch would make'} (
          {items.length})
        </div>
        {items.length ? (
          <StepList items={items} />
        ) : (
          <p className="text-muted text-[13px]">This branch pays nothing.</p>
        )}
        {reads ? (
          <p className="text-muted mt-1 text-[12px]">
            Plus {reads} read-only calls (balance and inbox).
          </p>
        ) : null}
      </div>

      {branch.status === 'SIMULATED' ? (
        <AuthorizeDialog
          branch={branch}
          items={items}
          busy={Boolean(ws.busy)}
          onConfirm={() => ws.authorize(branch.id)}
        />
      ) : null}

      {approval && branch.approvedPlanHash ? (
        <div className="border-accent rounded-[6px] border p-3">
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
                <span className="text-muted">Signed when the commit starts</span>
              </Field>
            )}
            <Field name="Approver">{approval.actor}</Field>
            <Field name="Time">
              <span className="font-mono">{clock(approval.at)}</span>
            </Field>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
