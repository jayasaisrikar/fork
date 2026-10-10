'use client';

import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useState } from 'react';
import { clock, day, usd, usdShort } from '@/lib/format';
import type { Message, RunView, Scenario } from '@/lib/types';
import { Chip, Money } from './primitives';

function invoiceStatus(
  scenario: Scenario,
  view: RunView | null,
  invoiceId: string,
  vendorId: string,
) {
  const invoice = scenario.invoices.find((item) => item.id === invoiceId);
  if (invoice && invoice.paidCents >= invoice.amountCents) return 'paid';
  if (invoice && invoice.paidCents > 0) return 'part paid';
  const held = view?.steps.some(
    (step) => step.status === 'HELD' && step.args.vendorId === vendorId,
  );
  if (held) return 'held';
  const active = view?.branches.find((branch) => branch.approvedPlanHash);
  const pays = active?.actions.find((action) => action.invoiceId === invoiceId)?.payCents ?? 0;
  if (active && pays === 0) return 'deferred';
  return 'open';
}

function MessageSheet({ message, onClose }: { message: Message | null; onClose: () => void }) {
  return (
    <Dialog.Root open={Boolean(message)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="border-line bg-surface text-text fixed top-0 right-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Chip tone="text">UNTRUSTED INPUT</Chip>
              <Dialog.Title className="mt-2 text-[16px] font-semibold">
                {message?.subject}
              </Dialog.Title>
              <Dialog.Description className="text-muted mt-1 font-mono text-[12px]">
                From {message?.from}
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close message" className="hover:bg-raised rounded-[4px] p-1">
              <X size={16} strokeWidth={1.5} />
            </Dialog.Close>
          </div>
          {/* plain text only. nothing in a message is ever rendered as markup or treated as an instruction. */}
          <p className="border-line mt-4 border-t pt-4 text-[14px] leading-relaxed whitespace-pre-wrap">
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

export function Books({ scenario, view }: { scenario: Scenario; view: RunView | null }) {
  const [open, setOpen] = useState<Message | null>(null);
  const due = scenario.invoices.reduce(
    (sum, invoice) => sum + invoice.amountCents - invoice.paidCents,
    0,
  );
  const vendor = (id: string) => scenario.vendors.find((item) => item.id === id)?.name ?? id;
  const messages = view?.messages ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="border-line border-b p-3">
        <div className="label">Cash on hand</div>
        <div className="money mt-1 text-[28px] leading-none font-medium">
          {usdShort(scenario.cashCents)}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 text-[12px]">
          <div>
            <dt className="text-muted">Minimum reserve</dt>
            <dd className="money text-[13px]">{usdShort(scenario.reserveCents)}</dd>
          </div>
          <div>
            <dt className="text-muted">Total due</dt>
            <dd className="money text-[13px]">{usdShort(due)}</dd>
          </div>
        </dl>
      </div>

      <div className="border-line border-b">
        <div className="label px-3 pt-3 pb-1">Invoices this week</div>
        <table className="w-full border-collapse text-[12px]">
          <thead className="sr-only">
            <tr>
              <th>Vendor</th>
              <th>Due</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {scenario.invoices.map((invoice) => (
              <tr key={invoice.id} className="border-line h-9 border-t">
                <td className="py-1 pl-3">
                  <div className="truncate">{vendor(invoice.vendorId)}</div>
                  <div className="text-muted text-[11px]">
                    {invoice.criticality} ·{' '}
                    {invoiceStatus(scenario, view, invoice.id, invoice.vendorId)}
                  </div>
                </td>
                <td className="text-muted px-2 font-mono whitespace-nowrap">
                  {day(invoice.dueDate)}
                </td>
                <td className="money pr-3 text-right">{usdShort(invoice.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="border-line border-b px-3 py-2 text-[12px]">
        <summary className="label cursor-pointer">Assumptions</summary>
        <ul className="text-muted mt-2 list-disc space-y-1 pl-4">
          <li>Today is {day(scenario.today)}. Every payment in a branch goes out today.</li>
          <li>
            Late fees are charged once on whatever is unpaid after the due date, within 14 days.
          </li>
          <li>Payments above {usd(scenario.holdAboveCents)} wait for a human in ArmorIQ.</li>
          <li>Fictional company. Sandbox ledger. No real payments.</li>
        </ul>
      </details>

      <div>
        <div className="label px-3 pt-3 pb-1">Inbox</div>
        {messages.length === 0 ? (
          <p className="text-muted px-3 pb-3 text-[12px]">No messages.</p>
        ) : (
          <ul>
            {messages.map((message) => (
              <li key={message.id} className="border-line border-t">
                <button
                  type="button"
                  onClick={() => setOpen(message)}
                  className="hover:bg-raised w-full px-3 py-2 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Chip tone="text">UNTRUSTED INPUT</Chip>
                    <span className="text-muted font-mono text-[11px]">
                      {clock(message.receivedAt)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[12px] font-medium">{message.subject}</div>
                  <div className="text-muted truncate font-mono text-[11px]">{message.from}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <MessageSheet message={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export { Money };
