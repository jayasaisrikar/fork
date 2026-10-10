'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { api } from '@/lib/api';

interface RunRow {
  id: number;
  createdAt: string;
  actor: string;
}

function RunList() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  useEffect(() => {
    api<{ runs: RunRow[] }>('GET', '/api/runs').then(
      (response) => setRuns(response.runs),
      () => setRuns([]),
    );
  }, []);

  if (!runs) return <p className="text-muted text-[13px]">Loading runs…</p>;
  if (!runs.length) {
    return (
      <p className="text-[14px]">
        No runs yet.{' '}
        <Link href="/app" className="text-accent underline underline-offset-2">
          Start one in the workspace
        </Link>
      </p>
    );
  }
  return (
    <>
      <h1 className="text-[28px] font-semibold">Runs</h1>
      <p className="text-muted mt-1 text-[13px]">
        Each run starts from a frozen snapshot of the books. Open one to read its full record.
      </p>
      <ul className="border-line bg-surface divide-line mt-4 divide-y rounded-[6px] border">
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={`/app/runs/${run.id}`}
              className="hover:bg-raised flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-[14px]"
            >
              <span className="font-mono font-medium">Run #{String(run.id).padStart(4, '0')}</span>
              <span className="text-muted">{run.actor}</span>
              <span className="text-muted font-mono text-[12px]">
                {run.createdAt.replace('T', ' ').slice(0, 19)} UTC
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function RunsPage() {
  return (
    <AppShell active="Runs">
      <RunList />
    </AppShell>
  );
}
