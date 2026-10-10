'use client';

import {
  ArrowUpRight,
  Ban,
  Check,
  Clock,
  Eye,
  FlaskConical,
  MailWarning,
  Minus,
} from 'lucide-react';
import { useMemo } from 'react';
import { describeStep, type StepTone } from '@/lib/describe';
import { clock, shortHash, usd } from '@/lib/format';
import type { AuditEvent, Branch, Message, Step } from '@/lib/types';
import type { Workspace } from '@/lib/use-workspace';
import { Inbox } from './books';
import { Button, SourcePill, VerdictPill } from './primitives';

const DOT: Record<StepTone, string> = {
  good: 'bg-[color-mix(in_srgb,var(--allow)_14%,var(--surface))] text-allow',
  bad: 'bg-[color-mix(in_srgb,var(--block)_14%,var(--surface))] text-block',
  gold: 'bg-[color-mix(in_srgb,var(--hold)_14%,var(--surface))] text-hold',
  purple: 'bg-[color-mix(in_srgb,var(--fork-reject)_14%,var(--surface))] text-fork-reject',
  gray: 'bg-bg text-muted',
};

function StepIcon({ step, tone }: { step: Step; tone: StepTone }) {
  const icon = { size: 15, strokeWidth: 2, 'aria-hidden': true } as const;
  if (tone === 'bad' || tone === 'purple') return <Ban {...icon} />;
  if (tone === 'gold') return <Clock {...icon} />;
  if (step.status !== 'EXECUTED') return <Minus {...icon} />;
  if (step.kind === 'read') return <Eye {...icon} />;
  return step.tool.startsWith('execute_') ? <ArrowUpRight {...icon} /> : <Check {...icon} />;
}

// who is behind the call: the approved plan, the inbox agent, or a deliberate security test
const origin = (step: Step) => (step.origin === 'agent' ? 'agent' : step.origin);

function argsLine(step: Step): string {
  const { vendorId, recipientId } = step.args as Record<string, string | undefined>;
  return vendorId && recipientId ? `${vendorId} → ${recipientId}` : '';
}

// every tool call in the order it happened: a plain sentence first, the evidence right under it
export function ActivityFeed({
  steps,
  events,
  vendorName,
}: {
  steps: Step[];
  events: AuditEvent[];
  vendorName: (id: unknown) => string;
}) {
  // an agent's attempt lands right after the step that triggered it
  const ordered = useMemo(
    () => [...steps].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id),
    [steps],
  );
  if (!ordered.length) {
    return (
      <p className="text-muted px-5 pb-5 text-[13px]">
        Nothing has been sent to ArmorIQ in this run yet. Calls appear here as they happen.
      </p>
    );
  }
  return (
    <>
      <ol aria-label="Activity" className="px-5 pb-2">
        {ordered.map((step) => {
          const told = describeStep(step, vendorName);
          const ref = step.receiptId ?? step.delegationId;
          return (
            <li
              key={step.id}
              className="border-line rail-row grid grid-cols-[32px_1fr] gap-3 border-b py-3.5 last:border-0"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-[9px] ${DOT[told.tone]}`}
              >
                <StepIcon step={step} tone={told.tone} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-[14px] font-bold">{told.title}</p>
                  <span className="text-muted font-mono text-[11px]">{clock(step.at)}</span>
                </div>
                {told.note ? <p className="text-muted mt-0.5 text-[12px]">{told.note}</p> : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                  <SourcePill source={origin(step)} />
                  <span className="font-mono">{step.tool}</span>
                  {argsLine(step) ? (
                    <span className="text-muted font-mono break-all">{argsLine(step)}</span>
                  ) : null}
                  {step.args.amountCents ? (
                    <span className="money">{usd(Number(step.args.amountCents))}</span>
                  ) : null}
                  <VerdictPill verdict={step.verdict} />
                  {step.errorClass ? (
                    <span className="text-muted font-mono">{step.errorClass}</span>
                  ) : null}
                  {ref ? (
                    <span className="text-muted font-mono">
                      {step.receiptId ? 'receipt' : 'delegation'} {shortHash(ref)}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <details className="border-line border-t px-5 py-3">
        <summary className="text-muted text-[12px] font-bold">
          Raw events ({events.length} since this page opened)
        </summary>
        {events.length ? (
          <ol className="divide-line mt-2 max-h-[280px] divide-y overflow-auto font-mono text-[11px]">
            {[...events].reverse().map((event) => (
              <li key={event.id} className="py-1.5">
                <span className="text-muted">
                  {clock(event.at)} {event.source}
                </span>{' '}
                {event.type}
                <pre className="text-muted mt-0.5 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify({ refs: event.refs, payload: event.payload })}
                </pre>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted mt-2 text-[12px]">
            No live events yet. The full log is on the Activity page.
          </p>
        )}
      </details>
    </>
  );
}

function Test({
  icon,
  name,
  children,
  button,
}: {
  icon: React.ReactNode;
  name: string;
  children: React.ReactNode;
  button: React.ReactNode;
}) {
  return (
    <div className="border-line flex flex-col gap-3 rounded-[10px] border p-4">
      <div className="flex items-center gap-2 text-[14px] font-extrabold">
        <span className="text-accent">{icon}</span>
        {name}
      </div>
      <p className="text-muted flex-1 text-[12px] leading-relaxed">{children}</p>
      {button}
    </div>
  );
}

// the two ways to attack an approved plan, out in the open. both use the real ArmorIQ path.
export function Safeguards({
  ws,
  branch,
  messages,
}: {
  ws: Workspace;
  branch: Branch | null;
  messages: Message[];
}) {
  const busy = Boolean(ws.busy);
  const approved = Boolean(branch?.approvedPlanHash);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Test
          icon={<MailWarning size={17} strokeWidth={1.75} aria-hidden />}
          name="A fake vendor email"
          button={
            <Button
              className="w-full"
              disabled={busy || !ws.view}
              reason={!ws.view ? 'Explore options first.' : undefined}
              onClick={() => ws.inject()}
            >
              Inject hostile message
            </Button>
          }
        >
          Drops a message into the inbox asking to redirect a vendor&apos;s payment. A real agent
          reads it mid-execution and may act on it. Add it before you execute.
        </Test>
        <Test
          icon={<FlaskConical size={17} strokeWidth={1.75} aria-hidden />}
          name="A tampered call"
          button={
            <Button
              className="w-full"
              disabled={busy || !approved}
              reason={
                !approved ? 'Approve a plan first. The test uses its approved steps.' : undefined
              }
              onClick={() => branch && ws.tamper(branch.id)}
            >
              Run tamper test
            </Button>
          }
        >
          Sends two calls the CFO never approved: a change of bank details, and a payment to a
          different recipient. Labelled as a security test in every record.
        </Test>
      </div>
      <div>
        <div className="label mb-2">Company inbox</div>
        <Inbox messages={messages} />
      </div>
    </div>
  );
}
