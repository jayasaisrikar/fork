'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { RunRecord } from '@/components/run-record';
import { api } from '@/lib/api';
import type { AuditEvent, RunView } from '@/lib/types';

function Record({ id }: { id: string }) {
  const [view, setView] = useState<RunView | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setView(await api<RunView>('GET', `/api/runs/${id}`));
        const audit = await api<{ events: AuditEvent[] }>('GET', `/api/audit?run=${id}&limit=500`);
        setEvents([...audit.events].reverse());
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [id]);

  if (problem) return <p role="alert">{problem}</p>;
  if (!view) return <p className="text-muted text-[13px]">Loading the record…</p>;
  return <RunRecord view={view} events={events} />;
}

export default function RunRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <AppShell active="History">
      <Link
        href="/app/runs"
        className="text-accent mb-5 inline-flex items-center gap-1.5 text-[13px] font-bold"
      >
        <ArrowLeft size={15} strokeWidth={2} aria-hidden /> All decisions
      </Link>
      <Record id={id} />
    </AppShell>
  );
}
