'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api, setCsrf } from '@/lib/api';
import type { Health } from '@/lib/types';
import { Shell, type Section } from './chrome';
import { buttonClass } from './primitives';

// the frame around the signed-in, read-only pages
export function AppShell({ active, children }: { active: Section; children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ email: string | null; csrfToken?: string }>('GET', '/api/auth/me');
        if (me.csrfToken) setCsrf(me.csrfToken);
        setEmail(me.email);
        setHealth(await api<Health>('GET', '/api/health'));
      } catch (error) {
        setEmail(null);
        setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  return (
    <Shell active={active} health={health}>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-10 lg:px-8">
        {problem ? (
          <p role="alert" className="card px-4 py-3 text-[13px]">
            {problem}
          </p>
        ) : null}
        {email === null && !problem ? (
          <div className="card max-w-[480px] p-6">
            <h1 className="text-[22px] font-extrabold">Sign in to read the records</h1>
            <p className="text-muted mt-2 text-[13px]">
              Decisions and activity belong to the CFO&apos;s account.
            </p>
            <Link href="/app" className={`${buttonClass('primary')} mt-4`}>
              Go to sign in
            </Link>
          </div>
        ) : null}
        {email === undefined ? <p className="text-muted text-[13px]">Loading…</p> : null}
        {email ? children : null}
      </main>
    </Shell>
  );
}
