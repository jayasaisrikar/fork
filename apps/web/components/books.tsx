'use client';

import { Dialog } from 'radix-ui';
import { Mail, X } from 'lucide-react';
import { useState } from 'react';
import { DONE } from '@/lib/describe';
import { clock, day, usd, usdShort } from '@/lib/format';
import type { Branch, Message, RunView, Scenario } from '@/lib/types';
import { Chip, Tag } from './primitives';

const owed = (scenario: Scenario) =>
  scenario.invoices.reduce((sum, invoice) => sum + invoice.amountCents - invoice.paidCents, 0);

function Cell({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="border-panel-line border-t p-4 sm:border-t-0 sm:border-l lg:p-5">
      <div className="text-panel-muted text-[12px]">{name}</div>
      <div className="figure mt-1 text-[22px] lg:text-[26px]">{children}</div>
    </div>
  );
}

// the problem in one strip: what there is, what is owed, and the gap between them
export function SituationBar({ base, live }: { base: Scenario; live: Scenario }) {
  const due = owed(base);
  const gap = due - base.cashCents;
  const open = base.invoices.filter((invoice) => invoice.paidCents < invoice.amountCents).length;
  return (
    <section
      aria-label="The situation"
      className="bg-panel text-panel-text grid grid-cols-2 overflow-hidden rounded-[14px] sm:grid-cols-[1.5fr_repeat(4,1fr)]"
    >
      <div className="col-span-2 p-4 sm:col-span-1 lg:p-5">
        <div className="text-panel-muted text-[12px]">The situation</div>
        <div className="figure mt-1 text-[22px] whitespace-normal lg:text-[26px]">
          {gap > 0 ? `You're ${usdShort(gap)} short.` : 'You can cover every bill.'}
        </div>
        <div className="text-panel-muted mt-1 text-[12px]">
          {open} {open === 1 ? 'invoice is' : 'invoices are'} due. Keep at least{' '}
          {usdShort(base.reserveCents)} in reserve.
        </div>
      </div>
      <Cell name="Cash at start">{usdShort(base.cashCents)}</Cell>
      <Cell name="Bills due">{usdShort(due)}</Cell>
      <Cell name="Shortfall">
        <span className={gap > 0 ? 'text-warm' : ''}>
          {gap > 0 ? `−${usdShort(gap)}` : usdShort(0)}
        </span>
      </Cell>
      <Cell name="Cash right now">
        <span className="text-bright">{usdShort(live.cashCents)}</span>
      </Cell>
    </section>
  );
}

const th = 'label px-3 py-2.5 text-left font-bold first:pl-5 last:pr-5';
const td = 'px-3 py-3 first:pl-5 last:pr-5';

// every invoice, and what the selected plan does with it
export function BillsTable({
  base,
  live,
  branch,
  view,
}: {
  base: Scenario;
  live: Scenario;
  branch: Branch | null;
  view: RunView | null;
}) {
  const vendor = (id: string) => base.vendors.find((item) => item.id === id)?.name ?? id;
  const lines = branch?.projection?.lines;
  const active = Boolean(branch?.approvedPlanHash);
  const finished = branch ? DONE.includes(branch.status) : false;
  const totalPaid = lines?.reduce((sum, line) => sum + line.paidCents, 0) ?? 0;
  const totalFees = lines?.reduce((sum, line) => sum + line.lateFeeCents, 0) ?? 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-[13px]">
        <thead>
          <tr className="border-line border-y">
            <th className={th}>Vendor</th>
            <th className={th}>Due</th>
            <th className={`${th} text-right`}>Amount due</th>
            <th className={th}>{branch ? `Plan ${branch.label}` : 'Plan'}</th>
            <th className={`${th} text-right`}>Pays now</th>
            <th className={`${th} text-right`}>Late fee</th>
          </tr>
        </thead>
        <tbody>
          {base.invoices.map((invoice) => {
            const line = lines?.find((item) => item.invoiceId === invoice.id);
            const now = live.invoices.find((item) => item.id === invoice.id);
            const paid = active && now && now.paidCents > invoice.paidCents;
            const held =
              active &&
              view?.steps.some(
                (step) => step.status === 'HELD' && step.args.vendorId === invoice.vendorId,
              );
            return (
              <tr key={invoice.id} className="border-line border-b last:border-0">
                <td className={td}>
                  <div className="font-bold">{vendor(invoice.vendorId)}</div>
                  <div className="text-muted text-[12px]">{invoice.criticality}</div>
                </td>
                <td className={`${td} text-muted font-mono text-[12px] whitespace-nowrap`}>
                  {day(invoice.dueDate)}
                </td>
                <td className={`${td} money text-right`}>
                  {usdShort(invoice.amountCents - invoice.paidCents)}
                </td>
                <td className={td}>
                  {invoice.paidCents >= invoice.amountCents ? (
                    <Tag tone="gray">Already paid</Tag>
                  ) : !line ? (
                    <span className="text-muted">—</span>
                  ) : paid ? (
                    <Tag tone="good">Paid</Tag>
                  ) : held ? (
                    <Tag tone="gold">Waiting in ArmorIQ</Tag>
                  ) : finished && line.paidCents > 0 ? (
                    <Tag tone="gold">Not paid</Tag>
                  ) : line.remainingCents <= 0 ? (
                    <Tag tone="accent">Pay in full</Tag>
                  ) : line.paidCents > 0 ? (
                    <Tag tone="gold">Part pay</Tag>
                  ) : (
                    <Tag tone="gray">Defer</Tag>
                  )}
                </td>
                <td className={`${td} money text-right font-medium`}>
                  {line ? usdShort(line.paidCents) : '—'}
                </td>
                <td className={`${td} money text-muted text-right`}>
                  {line ? usdShort(line.lateFeeCents) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        {lines ? (
          <tfoot>
            <tr className="border-line bg-bg border-t">
              <td className={`${td} font-extrabold`} colSpan={4}>
                Total for plan {branch?.label}
              </td>
              <td className={`${td} money text-right font-semibold`}>{usdShort(totalPaid)}</td>
              <td className={`${td} money text-right`}>{usdShort(totalFees)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      <details className="border-line border-t px-5 py-3 text-[12px]">
        <summary className="text-muted font-bold">How these numbers are worked out</summary>
        <ul className="text-muted mt-2 list-disc space-y-1 pl-4">
          <li>
            FORK calculates them from the books. The agent proposes who to pay, never the totals.
          </li>
          <li>Today is {day(base.today)}. Every payment in a plan goes out today.</li>
          <li>
            Late fees are charged once on whatever is unpaid after the due date, within 14 days.
          </li>
          <li>Payments above {usd(base.holdAboveCents)} wait for a person in ArmorIQ.</li>
        </ul>
      </details>
    </div>
  );
}

function MessageSheet({ message, onClose }: { message: Message | null; onClose: () => void }) {
  return (
    <Dialog.Root open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="border-line bg-surface text-text fixed top-0 right-0 z-50 flex h-full w-full max-w-[460px] flex-col border-l p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Chip tone="text">UNTRUSTED INPUT</Chip>
              <Dialog.Title className="mt-3 text-[20px] leading-tight font-extrabold">
                {message?.subject}
              </Dialog.Title>
              <Dialog.Description className="text-muted mt-1 font-mono text-[12px]">
                From {message?.from}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close message"
              className="hover:bg-raised rounded-[7px] p-1.5"
            >
              <X size={16} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          {/* plain text only. nothing in a message is ever rendered as markup or treated as an instruction. */}
          <p className="border-line mt-5 border-t pt-5 text-[14px] leading-relaxed whitespace-pre-wrap">
            {message?.body}
          </p>
          <p className="text-muted mt-auto text-[12px]">
            Messages are data. FORK never changes a vendor record because a message says so.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// what has arrived in the company inbox during this run. the agent reads it mid-execution.
export function Inbox({ messages }: { messages: Message[] }) {
  const [open, setOpen] = useState<Message | null>(null);
  if (!messages.length) {
    return <p className="text-muted text-[13px]">The inbox is empty.</p>;
  }
  return (
    <>
      <ul className="border-line divide-line divide-y overflow-hidden rounded-[9px] border">
        {messages.map((message) => (
          <li key={message.id}>
            <button
              type="button"
              onClick={() => setOpen(message)}
              className="hover:bg-raised flex w-full items-start gap-3 px-3.5 py-3 text-left"
            >
              <Mail
                size={16}
                strokeWidth={1.75}
                className="text-muted mt-0.5 shrink-0"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Chip tone="text">UNTRUSTED INPUT</Chip>
                  <span className="text-muted font-mono text-[11px]">
                    {clock(message.receivedAt)}
                  </span>
                </span>
                <span className="mt-1.5 block truncate text-[13px] font-bold">
                  {message.subject}
                </span>
                <span className="text-muted block truncate font-mono text-[11px]">
                  {message.from}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <MessageSheet message={open} onClose={() => setOpen(null)} />
    </>
  );
}
