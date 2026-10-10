'use client';

import { createColumnHelper, flexRender, tableFeatures, useTable } from '@tanstack/react-table';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { SourcePill, VerdictPill } from '@/components/primitives';
import { api, ENGINE_URL } from '@/lib/api';
import { shortHash } from '@/lib/format';
import type { AuditEvent } from '@/lib/types';

const features = tableFeatures({});
const column = createColumnHelper<typeof features, AuditEvent>();

const VERDICTS = [
  ['', 'All'],
  ['allow', 'ALLOW'],
  ['hold', 'HOLD'],
  ['block', 'BLOCK'],
  ['rejected_by_fork', 'REJECTED BY FORK'],
  ['error', 'ERROR'],
] as const;
const SOURCES = ['', 'agent', 'fork', 'armoriq', 'mcp', 'ledger', 'human'];

const reference = (event: AuditEvent) => {
  const ref =
    event.refs.receiptId ??
    event.refs.delegationId ??
    event.refs.planId ??
    event.refs.approvedPlanHash;
  return typeof ref === 'string' ? ref : '';
};

const columns = [
  column.display({
    id: 'time',
    header: 'Time (UTC)',
    cell: ({ row }) => (
      <span className="font-mono">{row.original.at.replace('T', ' ').slice(0, 19)}</span>
    ),
  }),
  column.display({
    id: 'source',
    header: 'Source',
    cell: ({ row }) => <SourcePill source={row.original.source} />,
  }),
  column.display({
    id: 'run',
    header: 'Run / step',
    cell: ({ row }) => (
      <span className="font-mono">
        {row.original.runId ? `#${row.original.runId}` : '—'}
        {typeof row.original.refs.stepIndex === 'number' ? ` · ${row.original.refs.stepIndex}` : ''}
      </span>
    ),
  }),
  column.display({ id: 'actor', header: 'Actor', cell: ({ row }) => row.original.actor }),
  column.display({
    id: 'action',
    header: 'Intended action',
    cell: ({ row }) => (
      <span className="font-mono">{String(row.original.payload.tool ?? row.original.type)}</span>
    ),
  }),
  column.display({
    id: 'verdict',
    header: 'Verdict',
    cell: ({ row }) =>
      row.original.payload.verdict ? (
        <VerdictPill verdict={String(row.original.payload.verdict)} />
      ) : null,
  }),
  column.display({
    id: 'outcome',
    header: 'Outcome',
    cell: ({ row }) =>
      row.original.type.startsWith('step.')
        ? row.original.type.slice(5).replace('_', ' ')
        : row.original.type.split('.').at(-1)?.replace(/_/g, ' '),
  }),
  column.display({
    id: 'ref',
    header: 'Reference',
    cell: ({ row }) => <span className="font-mono">{shortHash(reference(row.original))}</span>,
  }),
];

function Ledger() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [verdict, setVerdict] = useState('');
  const [source, setSource] = useState('');
  const [run, setRun] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<AuditEvent | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (verdict) params.set('verdict', verdict);
    if (source) params.set('source', source);
    if (/^\d+$/.test(run)) params.set('run', run);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [verdict, source, run, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      api<{ events: AuditEvent[] }>('GET', `/api/audit?limit=300&${query}`).then(
        (response) => setEvents(response.events),
        () => setEvents([]),
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const table = useTable<typeof features, AuditEvent>({ features, columns, data: events ?? [] });
  const input = 'border-line bg-surface h-8 rounded-[4px] border px-2 text-[13px]';
  const exportLink =
    'border-line hover:bg-raised inline-flex h-8 items-center rounded-[4px] border px-3 text-[13px] font-medium';

  return (
    <>
      <h1 className="text-[28px] font-semibold">Evidence ledger</h1>
      <p className="text-muted mt-1 max-w-[70ch] text-[13px]">
        Every event FORK recorded, newest first. The log is append-only: the database refuses
        updates and deletes.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <fieldset>
          <legend className="label mb-1">Verdict</legend>
          <div className="flex flex-wrap gap-1">
            {VERDICTS.map(([value, name]) => (
              <button
                key={name}
                type="button"
                aria-pressed={verdict === value}
                onClick={() => setVerdict(value)}
                className={`h-8 rounded-[4px] border px-2 text-[12px] font-medium ${verdict === value ? 'border-accent text-text' : 'border-line text-muted hover:text-text'}`}
              >
                {name}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col">
          <span className="label mb-1">Source</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className={input}
          >
            {SOURCES.map((name) => (
              <option key={name} value={name}>
                {name || 'Any'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="label mb-1">Run</span>
          <input
            value={run}
            onChange={(event) => setRun(event.target.value)}
            inputMode="numeric"
            className={`${input} w-20 font-mono`}
          />
        </label>
        <label className="flex min-w-[200px] flex-1 flex-col">
          <span className="label mb-1">Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
            className={input}
          />
        </label>
        <div className="flex gap-2">
          <a className={exportLink} href={`${ENGINE_URL}/api/audit?format=json&${query}`} download>
            Export JSON
          </a>
          <a className={exportLink} href={`${ENGINE_URL}/api/audit?format=csv&${query}`} download>
            Export CSV
          </a>
        </div>
      </div>

      <div className="border-line mt-4 overflow-x-auto rounded-[6px] border">
        <table className="bg-surface w-full min-w-[900px] border-collapse text-[12px]">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-line border-b">
                {group.headers.map((header) => (
                  <th key={header.id} className="label px-3 py-2 text-left font-normal">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.original.id}
                tabIndex={0}
                onClick={() => setOpen(row.original)}
                onKeyDown={(event) => event.key === 'Enter' && setOpen(row.original)}
                className="border-line hover:bg-raised h-9 cursor-pointer border-b last:border-0"
              >
                {row.getAllCells().map((cell) => (
                  <td key={cell.id} className="px-3 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {events && !events.length ? (
          <p className="text-muted p-3 text-[13px]">No events match these filters.</p>
        ) : null}
        {!events ? <p className="text-muted p-3 text-[13px]">Loading events…</p> : null}
      </div>
      {events ? <p className="text-muted mt-2 text-[12px]">{events.length} events shown.</p> : null}

      <Dialog.Root open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="border-line bg-surface text-text fixed top-0 right-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="font-mono text-[14px] font-semibold">
                  {open?.type}
                </Dialog.Title>
                <Dialog.Description className="text-muted mt-1 text-[12px]">
                  Event {open?.id}, recorded by {open?.source}. Secrets are stripped before anything
                  is stored.
                </Dialog.Description>
              </div>
              <Dialog.Close aria-label="Close event" className="hover:bg-raised rounded-[4px] p-1">
                <X size={16} strokeWidth={1.5} />
              </Dialog.Close>
            </div>
            <div className="label mt-4">References</div>
            <pre className="border-line bg-bg mt-1 overflow-auto rounded-[4px] border p-2 font-mono text-[12px] whitespace-pre-wrap">
              {JSON.stringify(open?.refs, null, 2)}
            </pre>
            <div className="label mt-4">Request and response</div>
            <pre className="border-line bg-bg mt-1 min-h-0 flex-1 overflow-auto rounded-[4px] border p-2 font-mono text-[12px] whitespace-pre-wrap">
              {JSON.stringify(open?.payload, null, 2)}
            </pre>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export default function AuditPage() {
  return (
    <AppShell active="Audit">
      <Ledger />
    </AppShell>
  );
}
