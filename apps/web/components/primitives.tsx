'use client';

import { Check, Copy } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { shortHash, usd } from '@/lib/format';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
  // shown as a tooltip when the button is disabled, so nothing is ever dead without a reason
  reason?: string;
};

const BUTTON = {
  primary: 'bg-accent text-bg border-accent hover:opacity-90',
  secondary: 'bg-transparent text-text border-line hover:bg-raised',
  quiet: 'bg-transparent text-muted border-transparent hover:text-text hover:bg-raised',
};

export function Button({
  variant = 'secondary',
  reason,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const button = (
    <button
      {...rest}
      disabled={disabled}
      aria-disabled={disabled}
      className={`inline-flex h-8 items-center justify-center gap-2 rounded-[4px] border px-3 text-[13px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON[variant]} ${className}`}
    >
      {children}
    </button>
  );
  if (!disabled || !reason) return button;
  return (
    <Hint text={reason}>
      <span tabIndex={0} className="inline-flex rounded-[4px]">
        {button}
      </span>
    </Hint>
  );
}

export function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="border-line bg-raised text-text z-50 max-w-[280px] rounded-[4px] border px-2 py-1.5 text-[12px] shadow-lg"
        >
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const PILL =
  'inline-flex h-5 items-center rounded-[4px] border px-1.5 font-mono text-[11px] font-medium whitespace-nowrap';

const VERDICTS: Record<string, { text: string; tone: string }> = {
  allow: { text: 'ALLOW', tone: 'text-allow border-allow' },
  hold: { text: 'HOLD', tone: 'text-hold border-hold' },
  block: { text: 'BLOCK', tone: 'text-block border-block' },
  error: { text: 'ERROR', tone: 'text-unknown border-unknown' },
  rejected_by_fork: { text: 'REJECTED BY FORK', tone: 'text-fork-reject border-fork-reject' },
};

// the only component that wears a verdict color
export function VerdictPill({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-muted font-mono text-[11px]">—</span>;
  const { text, tone } = VERDICTS[verdict] ?? {
    text: verdict.toUpperCase(),
    tone: 'text-unknown border-unknown',
  };
  return <span className={`${PILL} ${tone}`}>{text}</span>;
}

const SOURCES: Record<string, string> = {
  agent: 'Agent',
  fork: 'FORK',
  armoriq: 'ArmorIQ',
  mcp: 'MCP',
  ledger: 'Ledger',
  human: 'Human',
  fixture: 'Fixture',
  replan: 'Replan',
  runner: 'Runner',
  tamper_test: 'Security test',
};

export function SourcePill({ source }: { source: string | null }) {
  if (!source) return null;
  return (
    <span className={`${PILL} border-line text-muted font-sans`}>{SOURCES[source] ?? source}</span>
  );
}

export function Chip({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'text' | 'accent';
}) {
  const tones = {
    muted: 'text-muted border-line',
    text: 'text-text border-line',
    accent: 'text-accent border-accent',
  };
  return <span className={`${PILL} font-sans ${tones[tone]}`}>{children}</span>;
}

export function Money({ cents, className = '' }: { cents: number; className?: string }) {
  return (
    <span className={`money ${cents < 0 ? 'text-block' : ''} ${className}`}>{usd(cents)}</span>
  );
}

export function HashChip({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard?.writeText(value).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }
  return (
    <Hint text={value}>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label ?? 'value'} ${value}`}
        className="text-text hover:bg-raised inline-flex items-center gap-1.5 rounded-[4px] px-1 font-mono text-[12px]"
      >
        {shortHash(value)}
        {copied ? (
          <Check size={12} strokeWidth={1.5} aria-hidden />
        ) : (
          <Copy size={12} strokeWidth={1.5} className="text-muted" aria-hidden />
        )}
      </button>
    </Hint>
  );
}

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border-line bg-surface flex min-h-0 flex-col rounded-[6px] border ${className}`}
    >
      <header className="border-line flex h-9 shrink-0 items-center justify-between border-b px-3">
        <h2 className="label">{title}</h2>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted text-[12px]">{name}</dt>
      <dd className="text-right text-[13px]">{children}</dd>
    </div>
  );
}
