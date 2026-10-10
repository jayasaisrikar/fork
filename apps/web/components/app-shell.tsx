'use client';

import { Tooltip } from 'radix-ui';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { api, setCsrf } from '@/lib/api';
import type { Health } from '@/lib/types';
import { TopBar } from './chrome';

// the frame around the read-only pages. they are light-first because they get read and shared.
export function AppShell({
  active,
  crumb,
  children,
}: {
  active: 'Runs' | 'Audit';
  crumb?: string;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [health, setHealth] = useState<Health | null>(null);
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem('fork-record-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
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

  const toggle = () =>
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('fork-record-theme', next);
      return next;
    });

  return (
    <div
      data-theme={theme}
      className="bg-bg text-text flex min-h-dvh flex-col font-sans text-[14px]"
    >
      <Tooltip.Provider>
        <TopBar active={active} crumb={crumb} health={health} theme={theme} onTheme={toggle} />
        <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-6">
          {problem ? (
            <p
              role="alert"
              className="border-line bg-raised rounded-[6px] border px-3 py-2 text-[13px]"
            >
              {problem}
            </p>
          ) : null}
          {email === null && !problem ? (
            <p className="text-[14px]">
              Sign in as the CFO to read the records.{' '}
              <Link href="/app" className="text-accent underline underline-offset-2">
                Go to sign in
              </Link>
            </p>
          ) : null}
          {email ? children : null}
        </main>
        <footer className="border-line text-muted border-t px-4 py-3 text-[12px]">
          Verdicts are recorded from ArmorIQ responses. Fictional company. Sandbox ledger. No real
          payments.
        </footer>
      </Tooltip.Provider>
    </div>
  );
}
