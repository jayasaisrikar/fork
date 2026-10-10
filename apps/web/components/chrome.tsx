'use client';

import { Command } from 'cmdk';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Dialog, Popover } from 'radix-ui';
import { Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { clock } from '@/lib/format';
import type { AuditEvent, Health } from '@/lib/types';
import type { Workspace } from '@/lib/use-workspace';
import { Button, Chip, Field, Hint, VerdictPill } from './primitives';

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="FORK home">
      {/* three paths merging into one */}
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path
          d="M2 3 H7 Q10 3 10 6 V10 M2 10 H10 M2 17 H7 Q10 17 10 14 V10"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="1.25"
        />
        <path d="M10 10 H18" stroke="var(--accent)" strokeWidth="3" />
      </svg>
      <span className="font-display text-[16px] font-extrabold tracking-wide [font-stretch:120%]">
        FORK
      </span>
    </Link>
  );
}

function HealthRow({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
  return <Field name={name}>{detail ?? (ok ? 'Yes' : 'No')}</Field>;
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
          className="border-line hover:bg-raised flex h-7 items-center gap-2 rounded-[4px] border px-2 text-[12px]"
        >
          <span
            className={`h-2 w-2 rounded-full ${ready ? 'bg-accent' : 'bg-muted'}`}
            aria-hidden
          />
          {health ? (ready ? 'Enforcement ready' : 'Enforcement not ready') : 'Checking…'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          className="border-line bg-surface text-text z-50 w-[320px] rounded-[6px] border p-3 shadow-lg"
        >
          <div className="label">System health</div>
          {health ? (
            <dl className="mt-1">
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
              <ul className="mt-1 flex flex-wrap gap-1">
                {health.registeredTools.map((tool) => (
                  <li
                    key={tool}
                    className="border-line rounded-[4px] border px-1.5 font-mono text-[11px]"
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

const TABS: { name: string; href?: string; reason?: string }[] = [
  { name: 'Workspace', href: '/app' },
  { name: 'Runs', href: '/app/runs' },
  { name: 'Audit', href: '/app/audit' },
  { name: 'Lab', reason: 'The harness lab is optional and not built.' },
];

interface TopBarProps {
  active: 'Workspace' | 'Runs' | 'Audit';
  crumb?: string;
  health: Health | null;
  theme: 'dark' | 'light';
  onTheme: () => void;
  onPalette?: () => void;
}

export function TopBar({ active, crumb, health, theme, onTheme, onPalette }: TopBarProps) {
  return (
    <header className="border-line bg-surface flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:gap-4 sm:px-4">
      <Wordmark />
      <div className="text-muted hidden items-center gap-1.5 text-[13px] md:flex">
        <span>Kettle &amp; Pine</span>
        {crumb ? (
          <>
            <span aria-hidden>/</span>
            <span className="text-text font-mono">{crumb}</span>
          </>
        ) : null}
      </div>
      <nav className="flex min-w-0 items-center gap-1" aria-label="Sections">
        {TABS.map((tab) =>
          tab.href ? (
            <Link
              key={tab.name}
              href={tab.href}
              aria-current={tab.name === active ? 'page' : undefined}
              className={`rounded-[4px] px-2 py-1 text-[13px] ${tab.name === active ? 'bg-raised font-medium' : 'text-muted hover:text-text'}`}
            >
              {tab.name}
            </Link>
          ) : (
            <Hint key={tab.name} text={tab.reason ?? ''}>
              <span
                tabIndex={0}
                aria-disabled
                className="text-muted hidden cursor-not-allowed rounded-[4px] px-2 py-1 text-[13px] opacity-60 lg:inline"
              >
                {tab.name}
              </span>
            </Hint>
          ),
        )}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden sm:inline-flex">
          <Chip>SANDBOX</Chip>
        </span>
        <div className="hidden sm:block">
          <HealthPopover health={health} />
        </div>
        {onPalette ? (
          <Hint text="Command palette">
            <button
              type="button"
              onClick={onPalette}
              className="border-line text-muted hover:bg-raised hidden h-7 rounded-[4px] border px-2 font-mono text-[12px] sm:block"
            >
              ⌘K
            </button>
          </Hint>
        ) : null}
        <Hint text={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
          <button
            type="button"
            onClick={onTheme}
            aria-label="Toggle theme"
            className="border-line hover:bg-raised flex h-7 w-7 items-center justify-center rounded-[4px] border"
          >
            {theme === 'dark' ? (
              <Sun size={14} strokeWidth={1.5} />
            ) : (
              <Moon size={14} strokeWidth={1.5} />
            )}
          </button>
        </Hint>
      </div>
    </header>
  );
}

export const STAGES = ['Fork', 'Simulate', 'Authorize', 'Execute', 'Review'] as const;
export type Stage = (typeof STAGES)[number];

export function Stepper({ stage }: { stage: Stage }) {
  const at = STAGES.indexOf(stage);
  return (
    <ol className="flex items-center gap-1 overflow-x-auto" aria-label="Run stages">
      {STAGES.map((name, i) => (
        <li
          key={name}
          aria-current={i === at ? 'step' : undefined}
          className="flex items-center gap-1"
        >
          <span
            className={`flex h-7 items-center gap-2 rounded-[4px] px-2 text-[12px] whitespace-nowrap ${i === at ? 'bg-raised text-text font-semibold' : i < at ? 'text-text' : 'text-muted'}`}
          >
            <span className={`font-mono text-[11px] ${i <= at ? 'text-accent' : ''}`}>{i + 1}</span>
            {name}
          </span>
          {i < STAGES.length - 1 ? <span className="bg-line h-px w-4" aria-hidden /> : null}
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
      className="pointer-events-none fixed top-2 left-1/2 z-40 -translate-x-1/2"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {shown ? (
          <motion.div
            key={shown.id}
            initial={still ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.96 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="border-line bg-raised flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-lg"
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
        <Dialog.Content className="border-line bg-surface text-text fixed top-[18vh] left-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[6px] border shadow-lg">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Run a workspace action by name.
          </Dialog.Description>
          <Command label="Commands">
            <Command.Input
              placeholder="Type a command"
              className="border-line placeholder:text-muted h-11 w-full border-b bg-transparent px-3 text-[14px] outline-none"
            />
            <Command.List className="max-h-[320px] overflow-auto p-1">
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
                  className="data-[selected=true]:bg-raised flex cursor-pointer items-center justify-between gap-3 rounded-[4px] px-2 py-2 text-[13px] data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
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
  const input = 'border-line bg-bg h-9 w-full rounded-[4px] border px-2 text-[14px]';
  function submit(event: FormEvent) {
    event.preventDefault();
    void ws.signIn(password, email);
  }
  return (
    <form
      onSubmit={submit}
      className="border-line bg-surface w-full max-w-[380px] rounded-[6px] border p-5"
    >
      <h1 className="text-[20px] font-semibold">Sign in as the CFO</h1>
      <p className="text-muted mt-1 text-[13px]">
        Only the CFO can authorize a branch. This is a sandbox account for the demo.
      </p>
      <label className="label mt-4 block" htmlFor="email">
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
      <label className="label mt-3 block" htmlFor="password">
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
      <Button variant="primary" type="submit" disabled={Boolean(ws.busy)} className="mt-4 w-full">
        Sign in
      </Button>
    </form>
  );
}
