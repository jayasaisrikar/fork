'use client';

import { Command } from 'cmdk';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Dialog, Popover, Tooltip } from 'radix-ui';
import { Check, Menu, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { clock } from '@/lib/format';
import type { AuditEvent, Health } from '@/lib/types';
import { useTheme } from '@/lib/use-theme';
import type { Workspace } from '@/lib/use-workspace';
import { Button, buttonClass, Field, Hint, VerdictPill } from './primitives';

export function Wordmark() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="FORK home">
      <span className="bg-panel flex h-[30px] w-[30px] items-center justify-center rounded-[8px]">
        {/* three paths, one carried through */}
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
          <path
            d="M2 4 H6 Q10 4 10 7 V10 M2 16 H6 Q10 16 10 13 V10"
            fill="none"
            stroke="var(--panel-muted)"
            strokeWidth="1.5"
          />
          <path d="M2 10 H18" stroke="var(--bright)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </span>
      <span className="text-[21px] leading-none font-extrabold tracking-[-0.06em]">
        fork<span className="text-accent">.</span>
      </span>
    </Link>
  );
}

function HealthRow({ name, ok }: { name: string; ok: boolean }) {
  return <Field name={name}>{ok ? 'Yes' : 'No'}</Field>;
}

export function HealthPopover({ health }: { health: Health | null }) {
  const ready = Boolean(
    health?.armoriqConfigured && health.armoriqReachable && health.mcpReachable,
  );
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="border-line hover:bg-raised flex h-8 items-center gap-2 rounded-[7px] border px-2.5 text-[12px] font-bold whitespace-nowrap"
        >
          <span className={`h-2 w-2 rounded-full ${ready ? 'bg-allow' : 'bg-muted'}`} aria-hidden />
          {health ? (ready ? 'Enforcement ready' : 'Enforcement not ready') : 'Checking…'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          className="border-line bg-surface text-text z-50 w-[320px] rounded-[12px] border p-4 shadow-lg"
        >
          <div className="label">System health</div>
          <p className="text-muted mt-1 text-[12px]">
            Money can only move when ArmorIQ and the payment server are both reachable.
          </p>
          {health ? (
            <dl className="mt-2">
              <HealthRow name="ArmorIQ configured" ok={health.armoriqConfigured} />
              <HealthRow name="ArmorIQ reachable" ok={health.armoriqReachable} />
              <HealthRow name="MCP reachable" ok={health.mcpReachable} />
              <HealthRow name="Database" ok={health.db} />
              <Field name="Last real verdict">
                {health.armoriqVerified ? (
                  <span className="inline-flex items-center gap-2">
                    <VerdictPill verdict={health.armoriqVerified.verdict} />
                    <span className="font-mono text-[12px]">
                      {clock(health.armoriqVerified.at)}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted">None yet</span>
                )}
              </Field>
            </dl>
          ) : null}
          {health?.reason ? <p className="text-muted mt-2 text-[12px]">{health.reason}</p> : null}
          {health?.registeredTools.length ? (
            <>
              <div className="label mt-3">Tools registered on ArmorIQ</div>
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {health.registeredTools.map((tool) => (
                  <li
                    key={tool}
                    className="border-line rounded-[5px] border px-1.5 font-mono text-[11px]"
                  >
                    {tool}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// two kinds of page, two short menus. the product pages don't carry the brochure links and the
// brochure doesn't carry the product's.
const APP = [
  { name: 'Studio', href: '/app' },
  { name: 'History', href: '/app/runs' },
  { name: 'Activity', href: '/app/audit' },
  { name: 'Lab', href: '/app/lab' },
] as const;
const SITE = [
  { name: 'Overview', href: '/' },
  { name: 'How it works', href: '/how' },
] as const;

export type Section = (typeof APP)[number]['name'] | (typeof SITE)[number]['name'];

interface ShellProps {
  active: Section;
  // only the signed-in pages know the engine's health
  health?: Health | null;
  children: ReactNode;
}

const iconButton =
  'border-line hover:bg-raised flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border';

// the frame every page shares: header, theme, footer
export function Shell({ active, health, children }: ShellProps) {
  const { theme, toggle } = useTheme();
  const inApp = APP.some((item) => item.name === active);
  const tabs = inApp ? APP : SITE;
  const others = inApp ? SITE : APP;

  return (
    <div
      data-theme={theme}
      className="bg-bg text-text flex min-h-dvh flex-col font-sans text-[14px]"
    >
      <Tooltip.Provider>
        <header className="border-line bg-surface sticky top-0 z-30 border-b">
          <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center gap-3 px-4 lg:px-8">
            <Wordmark />
            {inApp ? (
              <span className="border-line text-muted hidden border-l pl-3 text-[13px] lg:block">
                Kettle &amp; Pine <span aria-hidden>·</span> sandbox
              </span>
            ) : null}

            <nav className="ml-3 hidden h-full items-stretch gap-1 md:flex" aria-label="Main">
              {tabs.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={item.name === active ? 'page' : undefined}
                  className={`-mb-px flex items-center border-b-2 px-3 text-[14px] font-bold ${
                    item.name === active
                      ? 'border-ink text-text'
                      : 'text-muted hover:text-text border-transparent'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              {inApp ? (
                <Link
                  href="/how"
                  className="text-muted hover:text-text hidden px-2 text-[13px] font-bold md:block"
                >
                  How it works
                </Link>
              ) : null}
              {health !== undefined ? (
                <div className="hidden md:block">
                  <HealthPopover health={health} />
                </div>
              ) : null}
              <Hint text={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
                <button
                  type="button"
                  onClick={toggle}
                  aria-label="Toggle theme"
                  className={iconButton}
                >
                  {theme === 'dark' ? (
                    <Sun size={16} strokeWidth={1.75} />
                  ) : (
                    <Moon size={16} strokeWidth={1.75} />
                  )}
                </button>
              </Hint>
              {inApp ? null : (
                <Link href="/app" className={`${buttonClass('primary', 'sm')} h-9`}>
                  Open studio
                </Link>
              )}

              {/* on a phone every link lives in one menu, so the header stays a single row */}
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button type="button" aria-label="Menu" className={`${iconButton} md:hidden`}>
                    <Menu size={17} strokeWidth={1.75} />
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    align="end"
                    sideOffset={8}
                    className="border-line bg-surface text-text z-50 w-[240px] rounded-[12px] border p-2 shadow-lg"
                  >
                    <nav aria-label="Menu" className="flex flex-col">
                      {[...tabs, ...others].map((item, i) => (
                        <Link
                          key={item.name}
                          href={item.href}
                          aria-current={item.name === active ? 'page' : undefined}
                          className={`rounded-[8px] px-3 py-2.5 text-[14px] font-bold ${
                            item.name === active ? 'bg-raised' : 'hover:bg-raised'
                          } ${i === tabs.length ? 'border-line mt-2 rounded-t-none border-t pt-3.5' : ''}`}
                        >
                          {item.name}
                        </Link>
                      ))}
                    </nav>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>
          </div>
        </header>
        {children}
        <footer className="border-line text-muted mt-auto border-t">
          <div className="mx-auto flex w-full max-w-[1240px] flex-wrap justify-between gap-x-6 gap-y-1 px-4 py-5 text-[12px] lg:px-8">
            <span>fork. A branch-and-commit harness for autonomous agents.</span>
            <span>
              Verdicts are recorded from ArmorIQ responses. Fictional company. Sandbox ledger. No
              real payments.
            </span>
          </div>
        </footer>
      </Tooltip.Provider>
    </div>
  );
}

export const STAGES = ['Explore', 'Approve', 'Execute', 'Review'] as const;
export type Stage = (typeof STAGES)[number];

export function StepBar({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <ol className="flex items-center gap-2 overflow-x-auto" aria-label="Steps">
      {STAGES.map((name, i) => (
        <li
          key={name}
          aria-current={i === at ? 'step' : undefined}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-bold whitespace-nowrap ${
            i === at
              ? 'bg-ink text-on-ink border-ink'
              : i < at
                ? 'bg-mint text-accent border-transparent'
                : 'bg-surface text-muted border-line'
          }`}
        >
          {i < at ? (
            <Check size={13} strokeWidth={2.5} aria-hidden />
          ) : (
            <span className="font-mono">{i + 1}</span>
          )}
          {name}
        </li>
      ))}
    </ol>
  );
}

// the newest verdict, shown for three seconds above everything
export function VerdictIsland({ events }: { events: AuditEvent[] }) {
  const still = useReducedMotion();
  const [shown, setShown] = useState<AuditEvent | null>(null);
  const latest = [...events]
    .reverse()
    .find((event) => event.type.startsWith('step.') && event.payload.verdict);
  useEffect(() => {
    if (!latest || Date.now() - new Date(latest.at).getTime() > 5000) return;
    setShown(latest);
    const timer = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(timer);
    // only a new verdict restarts the timer
  }, [latest?.id]);

  return (
    <div
      className="pointer-events-none fixed top-[68px] left-1/2 z-40 -translate-x-1/2"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {shown ? (
          <motion.div
            key={shown.id}
            // it slides, it never fades, so the verdict is never shown at low contrast
            initial={still ? false : { y: -12, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={still ? undefined : { y: -12, scale: 0.96 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="border-line bg-surface flex items-center gap-2 rounded-full border px-3.5 py-2 shadow-lg"
          >
            <VerdictPill verdict={String(shown.payload.verdict)} />
            <span className="font-mono text-[12px]">{String(shown.payload.tool)}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export interface PaletteAction {
  name: string;
  run?: () => void;
  reason?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="border-line bg-surface text-text fixed top-[18vh] left-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[12px] border shadow-lg">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Run a studio action by name.</Dialog.Description>
          <Command label="Commands">
            <Command.Input
              placeholder="Type a command"
              className="border-line placeholder:text-muted h-12 w-full border-b bg-transparent px-4 text-[14px] outline-none"
            />
            <Command.List className="max-h-[320px] overflow-auto p-1.5">
              <Command.Empty className="text-muted p-3 text-[13px]">
                No command matches.
              </Command.Empty>
              {actions.map((action) => (
                <Command.Item
                  key={action.name}
                  disabled={!action.run}
                  onSelect={() => {
                    action.run?.();
                    onOpenChange(false);
                  }}
                  className="data-[selected=true]:bg-raised flex cursor-pointer items-center justify-between gap-3 rounded-[7px] px-2.5 py-2 text-[13px] data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
                >
                  {action.name}
                  {action.reason ? (
                    <span className="text-muted text-[12px]">{action.reason}</span>
                  ) : null}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function SignIn({ ws }: { ws: Workspace }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const input = 'border-line bg-bg mt-1.5 h-10 w-full rounded-[8px] border px-3 text-[14px]';
  function submit(event: FormEvent) {
    event.preventDefault();
    void ws.signIn(password, email);
  }
  return (
    <form onSubmit={submit} className="card w-full max-w-[400px] p-6">
      <div className="eyebrow">Decision studio</div>
      <h1 className="mt-2 text-[26px] leading-tight font-extrabold">Sign in as the CFO</h1>
      <p className="text-muted mt-2 text-[13px] leading-relaxed">
        Only the CFO can approve a plan. This is a sandbox account for the demo, and no real money
        moves.
      </p>
      <label className="label mt-5 block" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className={input}
      />
      <label className="label mt-4 block" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className={input}
      />
      <Button variant="primary" type="submit" disabled={Boolean(ws.busy)} className="mt-5 w-full">
        Sign in
      </Button>
    </form>
  );
}
