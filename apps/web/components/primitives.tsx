'use client';

import { Check, ChevronDown, Copy } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { shortHash, usd } from '@/lib/format';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'soft' | 'quiet';
  size?: 'md' | 'sm';
  // shown as a tooltip when the button is disabled, so nothing is ever dead without a reason
  reason?: string;
};

const BUTTON = {
  primary: 'bg-ink text-on-ink border-ink hover:opacity-90',
  secondary: 'bg-surface text-text border-line hover:bg-raised',
  soft: 'bg-mint text-accent border-transparent hover:opacity-85',
  quiet: 'bg-transparent text-muted border-transparent hover:text-text hover:bg-raised',
};

const SIZE = {
  md: 'h-10 px-4 text-[13px] rounded-[8px]',
  sm: 'h-8 px-3 text-[12px] rounded-[7px]',
};

export const buttonClass = (variant: keyof typeof BUTTON = 'secondary', size: 'md' | 'sm' = 'md') =>
  `inline-flex items-center justify-center gap-2 border font-bold whitespace-nowrap transition-[opacity,background-color] disabled:cursor-not-allowed disabled:opacity-45 ${SIZE[size]} ${BUTTON[variant]}`;

export function Button({
  variant = 'secondary',
  size = 'md',
  reason,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const button = (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      aria-disabled={disabled}
      className={`${buttonClass(variant, size)} ${className}`}
    >
      {children}
    </button>
  );
  if (!disabled || !reason) return button;
  return (
    <Hint text={reason}>
      <span tabIndex={0} className={`inline-flex rounded-[8px] ${className}`}>
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
          className="border-line bg-surface text-text z-50 max-w-[280px] rounded-[8px] border px-2.5 py-1.5 text-[12px] shadow-lg"
        >
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export type Tone = 'good' | 'bad' | 'gold' | 'gray' | 'purple' | 'accent';

// spelled out so tailwind can see every class
const TONES: Record<Tone, string> = {
  good: 'text-allow border-[color-mix(in_srgb,var(--allow)_30%,var(--surface))] bg-[color-mix(in_srgb,var(--allow)_11%,var(--surface))]',
  bad: 'text-block border-[color-mix(in_srgb,var(--block)_30%,var(--surface))] bg-[color-mix(in_srgb,var(--block)_11%,var(--surface))]',
  gold: 'text-hold border-[color-mix(in_srgb,var(--hold)_30%,var(--surface))] bg-[color-mix(in_srgb,var(--hold)_11%,var(--surface))]',
  purple:
    'text-fork-reject border-[color-mix(in_srgb,var(--fork-reject)_30%,var(--surface))] bg-[color-mix(in_srgb,var(--fork-reject)_11%,var(--surface))]',
  accent: 'text-accent border-transparent bg-mint',
  gray: 'text-muted border-line bg-bg',
};

const PILL =
  'inline-flex h-[22px] items-center gap-1.5 rounded-[6px] border px-2 text-[11px] font-bold whitespace-nowrap';

// a status word with a dot. the word carries the meaning, the color only backs it up.
export function Tag({
  children,
  tone = 'gray',
  dot = true,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`${PILL} ${TONES[tone]}`}>
      {dot ? <span className="h-[5px] w-[5px] rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

const VERDICTS: Record<string, { text: string; tone: Tone }> = {
  allow: { text: 'ALLOW', tone: 'good' },
  hold: { text: 'HOLD', tone: 'gold' },
  block: { text: 'BLOCK', tone: 'bad' },
  error: { text: 'ERROR', tone: 'gray' },
  rejected_by_fork: { text: 'REJECTED BY FORK', tone: 'purple' },
};

// what ArmorIQ (or FORK) answered, in its own word
export function VerdictPill({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-muted font-mono text-[11px]">—</span>;
  const { text, tone } = VERDICTS[verdict] ?? { text: verdict.toUpperCase(), tone: 'gray' as Tone };
  return <span className={`${PILL} font-mono font-semibold ${TONES[tone]}`}>{text}</span>;
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
  runner: 'Approved plan',
  tamper_test: 'Security test',
};

export function SourcePill({ source }: { source: string | null }) {
  if (!source) return null;
  return <span className={`${PILL} ${TONES.gray}`}>{SOURCES[source] ?? source}</span>;
}

export function Chip({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'text' | 'accent';
}) {
  const tones = {
    muted: TONES.gray,
    text: 'text-text border-line bg-bg',
    accent: TONES.accent,
  };
  return <span className={`${PILL} ${tones[tone]}`}>{children}</span>;
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
        className="text-text hover:bg-raised inline-flex items-center gap-1.5 rounded-[5px] px-1 font-mono text-[12px]"
      >
        {shortHash(value)}
        {copied ? (
          <Check size={12} strokeWidth={1.75} aria-hidden />
        ) : (
          <Copy size={12} strokeWidth={1.75} className="text-muted" aria-hidden />
        )}
      </button>
    </Hint>
  );
}

export function Card({
  title,
  hint,
  action,
  children,
  className = '',
  flush,
}: {
  title?: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  // no padding around the body, for tables and charts that run edge to edge
  flush?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-[18px] leading-tight font-extrabold">{title}</h2>
            {hint ? <p className="text-muted mt-1 text-[13px]">{hint}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={flush ? '' : `px-5 pb-5 ${title ? '' : 'pt-5'}`}>{children}</div>
    </section>
  );
}

// a collapsed section for the detail most people don't need first
export function Disclosure({
  title,
  aside,
  children,
  open,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="card overflow-hidden" open={open}>
      <summary className="hover:bg-raised flex items-center justify-between gap-3 px-5 py-4">
        <span className="text-[14px] font-extrabold">{title}</span>
        <span className="text-muted flex items-center gap-2 text-[12px]">
          {aside}
          <ChevronDown size={16} strokeWidth={2} className="chevron text-accent" aria-hidden />
        </span>
      </summary>
      <div className="border-line border-t">{children}</div>
    </details>
  );
}

// a short note that explains what the numbers above it mean
export function Insight({
  children,
  tone = 'good',
}: {
  children: ReactNode;
  tone?: 'good' | 'bad' | 'purple' | 'gold';
}) {
  return (
    <div className={`rounded-[9px] border px-3.5 py-3 text-[13px] leading-relaxed ${TONES[tone]}`}>
      <div className="text-text">{children}</div>
    </div>
  );
}

export function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="border-line flex items-baseline justify-between gap-3 border-b py-2.5 last:border-0">
      <dt className="text-muted text-[13px]">{name}</dt>
      <dd className="text-right text-[13px] font-semibold">{children}</dd>
    </div>
  );
}
