'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { buttonClass, Tag } from '@/components/primitives';
import { api } from '@/lib/api';
import { statusOf } from '@/lib/describe';
import { usdShort } from '@/lib/format';
import type { RunView } from '@/lib/types';

interface RunRow {
  id: number;
  createdAt: string;
  actor: string;
}

// the plan a run is remembered by: the one that was executed, else approved, else the first
function mainBranch(view: RunView) {
  return (
    view.branches.find((branch) =>
      view.executions.some((item) => item.branchId === branch.id && item.kind === 'commit'),
    ) ??
    view.branches.find((branch) => branch.approvedPlanHash) ??
    view.branches[0]
  );
}

function Row({ run, view }: { run: RunRow; view?: RunView }) {
  const branch = view ? mainBranch(view) : undefined;
  const paid = view?.receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0) ?? 0;
  const status = branch ? statusOf(branch.status) : null;
  return (
    <li className="border-line border-b last:border-0">
      <Link
        href={`/app/runs/${run.id}`}
        className="hover:bg-raised flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-5"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            {status ? (
              <Tag tone={status.tone}>{status.text}</Tag>
            ) : (
              <Tag>{view ? 'No plans yet' : 'Loading'}</Tag>
            )}
            <span className="text-muted font-mono text-[12px]">
              Run #{String(run.id).padStart(4, '0')}
            </span>
          </span>
          <span className="mt-1.5 block text-[17px] font-extrabold tracking-[-0.03em]">
            {branch ? `Plan ${branch.label}: ${branch.title}` : 'Nothing decided yet'}
          </span>
          <span className="text-muted mt-0.5 block text-[13px]">
            {run.actor} · {run.createdAt.replace('T', ' ').slice(0, 16)} UTC
          </span>
        </span>
        <span className="flex items-center gap-5">
          <span className="text-right">
            <span className="figure block text-[20px]">{usdShort(paid)}</span>
            <span className="text-muted block text-[12px]">
              {view?.receipts.length ?? 0} payment{view?.receipts.length === 1 ? '' : 's'} made
            </span>
          </span>
          <span className={buttonClass('secondary', 'sm')}>
            View receipt <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
          </span>
        </span>
      </Link>
    </li>
  );
}

function RunList() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [views, setViews] = useState<Record<number, RunView>>({});
  useEffect(() => {
    (async () => {
      const list = await api<{ runs: RunRow[] }>('GET', '/api/runs').then(
        (response) => response.runs,
        () => [],
      );
      setRuns(list);
      // the list only has ids. the outcome of each run comes from its own record.
      const loaded = await Promise.all(
        list.slice(0, 30).map((run) =>
          api<RunView>('GET', `/api/runs/${run.id}`).then(
            (view) => [run.id, view] as const,
            () => null,
          ),
        ),
      );
      setViews(Object.fromEntries(loaded.filter((item) => item !== null)));
    })();
  }, []);

  return (
    <>
      <div className="eyebrow">History</div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] leading-[1.08] font-extrabold sm:text-[40px]">
            Every choice, accounted for.
          </h1>
          <p className="text-muted mt-2 max-w-[60ch] text-[14px]">
            Each decision starts from a frozen snapshot of the books. Open one to see exactly what
            was approved, paid, or prevented.
          </p>
        </div>
        <Link href="/app" className={buttonClass('primary')}>
          Open the studio
        </Link>
      </div>
      {!runs ? (
        <p className="text-muted mt-6 text-[13px]">Loading decisions…</p>
      ) : !runs.length ? (
        <div className="card mt-6 p-6 text-[14px]">
          No decisions yet.{' '}
          <Link href="/app" className="text-accent font-bold underline underline-offset-2">
            Start one in the studio
          </Link>
        </div>
      ) : (
        <ul className="card mt-6 overflow-hidden">
          {runs.map((run) => (
            <Row key={run.id} run={run} view={views[run.id]} />
          ))}
        </ul>
      )}
    </>
  );
}

export default function RunsPage() {
  return (
    <AppShell active="History">
      <RunList />
    </AppShell>
  );
}
