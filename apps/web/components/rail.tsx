'use client';

import { createColumnHelper, flexRender, tableFeatures, useTable } from '@tanstack/react-table';
import { Tabs } from 'radix-ui';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { clock, shortHash, usd } from '@/lib/format';
import type { AuditEvent, Branch, Step } from '@/lib/types';
import type { Workspace } from '@/lib/use-workspace';
import { Button, Chip, SourcePill, VerdictPill } from './primitives';

const features = tableFeatures({});
const column = createColumnHelper<typeof features, Step>();

function summary(step: Step): string {
  const { vendorId, recipientId, scenarioId } = step.args as Record<string, string | undefined>;
  if (vendorId && recipientId) return `${vendorId} → ${recipientId}`;
  return scenarioId ?? '';
}

// who is behind the row: the approved runner, the inbox agent, or a deliberate security test
const origin = (step: Step) =>
  step.origin === 'runner' ? step.source : step.origin === 'agent' ? 'agent' : 'tamper_test';

const columns = [
  column.display({
    id: 'n',
    header: '#',
    cell: ({ row }) => (
      <span className="text-muted font-mono">{row.original.stepIndex ?? '·'}</span>
    ),
  }),
  column.display({
    id: 'at',
    header: 'Time',
    cell: ({ row }) => <span className="font-mono">{clock(row.original.at)}</span>,
  }),
  column.display({
    id: 'source',
    header: 'Source',
    cell: ({ row }) => <SourcePill source={origin(row.original)} />,
  }),
  column.display({
    id: 'tool',
    header: 'Tool',
    cell: ({ row }) => <span className="font-mono">{row.original.tool}</span>,
  }),
  column.display({
    id: 'args',
    header: 'Arguments',
    cell: ({ row }) => <span className="text-muted font-mono">{summary(row.original)}</span>,
  }),
  column.display({
    id: 'amount',
    header: 'Amount',
    cell: ({ row }) =>
      row.original.args.amountCents ? (
        <span className="money">{usd(Number(row.original.args.amountCents))}</span>
      ) : null,
  }),
  column.display({
    id: 'verdict',
    header: 'Verdict',
    cell: ({ row }) => <VerdictPill verdict={row.original.verdict} />,
  }),
  column.display({
    id: 'outcome',
    header: 'Outcome',
    cell: ({ row }) => {
      const step = row.original;
      const label = step.status.toLowerCase().replace('_', ' ');
      // ArmorIQ said yes and our own MCP said no. say so, in FORK's color, not ArmorIQ's.
      if (step.source === 'mcp')
        return <span className="text-fork-reject">refused by the MCP</span>;
      return (
        <span className={step.status === 'EXECUTED' ? 'text-text' : 'text-muted'}>{label}</span>
      );
    },
  }),
  column.display({
    id: 'reason',
    header: 'Reason',
    cell: ({ row }) => (
      <span className="text-muted font-mono">{row.original.errorClass ?? ''}</span>
    ),
  }),
  column.display({
    id: 'ref',
    header: 'Reference',
    cell: ({ row }) => {
      const ref = row.original.receiptId ?? row.original.delegationId;
      return ref ? <span className="font-mono">{shortHash(ref)}</span> : null;
    },
  }),
];

const RIGHT = new Set(['amount']);

function StepTable({ steps }: { steps: Step[] }) {
  const table = useTable<typeof features, Step>({
    features,

    columns,
    data: steps,
  });
  if (!steps.length)
    return (
      <p className="text-muted p-3 text-[13px]">
        Nothing has been sent to ArmorIQ in this run yet.
      </p>
    );
  return (
    <table className="w-full min-w-[980px] border-collapse text-[12px]">
      <thead className="bg-surface sticky top-0">
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} className="border-line border-b">
            {group.headers.map((header) => (
              <th
                key={header.id}
                className={`label px-3 py-1.5 font-normal ${RIGHT.has(header.column.id) ? 'text-right' : 'text-left'}`}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.original.id} className="border-line rail-row h-9 border-b last:border-0">
            {row.getAllCells().map((cell) => (
              <td
                key={cell.id}
                className={`px-3 whitespace-nowrap ${RIGHT.has(cell.column.id) ? 'text-right' : ''}`}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tab =
  'text-muted data-[state=active]:text-text data-[state=active]:border-accent -mb-px h-9 border-b-2 border-transparent px-3 text-[12px] font-medium';

export function ExecutionRail({
  steps,
  events,
  branch,
  ws,
}: {
  steps: Step[];
  events: AuditEvent[];
  branch: Branch | null;
  ws: Workspace;
}) {
  const [open, setOpen] = useState(true);
  // in the order things happened. an agent's attempt lands right after the step that triggered it.
  const ordered = useMemo(
    () => [...steps].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id),
    [steps],
  );
  const busy = Boolean(ws.busy);
  const authorized = Boolean(branch?.approvedPlanHash);
  const stopped = branch
    ? ['BLOCKED', 'PARTIALLY_COMMITTED', 'CANCELLED', 'STALE'].includes(branch.status)
    : false;

  return (
    <Tabs.Root
      defaultValue="steps"
      className="border-line bg-surface flex min-h-0 flex-col rounded-[6px] border"
    >
      <div className="border-line flex shrink-0 flex-wrap items-center gap-1 border-b px-1">
        <span className="label px-2">Execution</span>
        <Tabs.List className="flex" aria-label="Execution views">
          <Tabs.Trigger value="steps" className={tab}>
            Calls
          </Tabs.Trigger>
          <Tabs.Trigger value="raw" className={tab}>
            Raw events
          </Tabs.Trigger>
        </Tabs.List>
        <div className="ml-auto flex flex-wrap items-center gap-1 py-1">
          <Chip>Security test</Chip>
          <Button
            disabled={busy || !ws.view}
            reason={!ws.view ? 'Start a run first.' : undefined}
            onClick={() => ws.inject()}
          >
            Inject hostile message
          </Button>
          <Button
            disabled={busy || !authorized}
            reason={
              !authorized ? 'Authorize a branch first. The test uses its approved plan.' : undefined
            }
            onClick={() => branch && ws.tamper(branch.id)}
          >
            Run tamper test
          </Button>
          <Button
            disabled={busy || !stopped}
            reason={!stopped ? 'Replan is for a branch that stopped short.' : undefined}
            onClick={() => branch && ws.replan(branch.id)}
          >
            Replan from here
          </Button>
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? 'Collapse execution rail' : 'Expand execution rail'}
            onClick={() => setOpen(!open)}
            className="hover:bg-raised rounded-[4px] p-1.5"
          >
            {open ? (
              <ChevronDown size={14} strokeWidth={1.5} />
            ) : (
              <ChevronUp size={14} strokeWidth={1.5} />
            )}
          </button>
        </div>
      </div>
      {open ? (
        <>
          <Tabs.Content value="steps" className="max-h-[236px] min-h-[72px] overflow-auto">
            <StepTable steps={ordered} />
          </Tabs.Content>
          <Tabs.Content value="raw" className="max-h-[236px] min-h-[72px] overflow-auto">
            {events.length ? (
              <ol className="divide-line divide-y font-mono text-[11px]">
                {[...events].reverse().map((event) => (
                  <li key={event.id} className="px-3 py-1.5">
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
              <p className="text-muted p-3 font-sans text-[13px]">No events yet.</p>
            )}
          </Tabs.Content>
        </>
      ) : null}
    </Tabs.Root>
  );
}
