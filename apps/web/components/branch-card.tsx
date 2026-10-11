'use client';

import { motion, useReducedMotion } from 'motion/react';
import { statusOf } from '@/lib/describe';
import { shortHash, usdShort } from '@/lib/format';
import type { Branch } from '@/lib/types';
import { Money, SourcePill, Tag } from './primitives';

export const statusText = (status: Branch['status']) => statusOf(status).text;

// a ring that draws itself once, when the CFO signs
export function AuthorizationSeal({ hash, size = 44 }: { hash: string; size?: number }) {
  const still = useReducedMotion();
  const radius = size / 2 - 3;
  const length = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-2.5" aria-label={`Authorized, plan hash ${hash}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeDasharray={length}
          initial={still ? { opacity: 0 } : { strokeDashoffset: length }}
          animate={still ? { opacity: 1 } : { strokeDashoffset: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <path
          d={`M${size * 0.32} ${size * 0.52} l${size * 0.12} ${size * 0.12} l${size * 0.24} -${size * 0.26}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
        />
      </svg>
      <div className="leading-tight">
        <div className="text-accent text-[12px] font-extrabold">Approved by the CFO</div>
        <div className="text-muted font-mono text-[11px]">{shortHash(hash)}</div>
      </div>
    </div>
  );
}

function StatusTags({ branch, recommended }: { branch: Branch; recommended?: boolean }) {
  const status = statusOf(branch.status);
  return (
    <>
      {branch.status === 'INFEASIBLE' ? <Tag tone="bad">Not possible</Tag> : null}
      {branch.status === 'SIMULATED' ? (
        <Tag tone={recommended ? 'good' : 'gray'}>{recommended ? 'Recommended' : 'Alternative'}</Tag>
      ) : (
        <Tag tone={status.tone}>{status.text}</Tag>
      )}
      {branch.source !== 'agent' ? <SourcePill source={branch.source} /> : null}
    </>
  );
}

const frame = (branch: Branch, selected: boolean) => {
  const unsigned = branch.source === 'replan' && !branch.approvedPlanHash;
  return `text-left transition-colors ${
    selected
      ? 'border-accent bg-mint shadow-[inset_0_0_0_1px_var(--accent)]'
      : 'border-line bg-surface hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--line))]'
  } ${unsigned ? 'border-dashed' : ''} ${branch.status === 'INFEASIBLE' && !selected ? 'hatch' : ''}`;
};

// one way forward, as a card you can pick. the studio's main control.
export function PlanCard({
  branch,
  selected,
  recommended,
  reason,
  onSelect,
}: {
  branch: Branch;
  selected: boolean;
  recommended?: boolean;
  reason?: string;
  onSelect: () => void;
}) {
  const p = branch.projection;
  const approvals = branch.risk?.approvalsNeeded ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex h-full min-h-[228px] w-full flex-col gap-2 rounded-[12px] border-[1.5px] p-4 ${frame(branch, selected)}`}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="border-line bg-surface mr-auto flex h-7 min-w-7 items-center justify-center rounded-[6px] border px-1.5 text-[13px] font-extrabold">
          {branch.label}
        </span>
        <StatusTags branch={branch} recommended={recommended} />
      </span>
      <span className="mt-1 text-[15px] leading-snug font-extrabold">{branch.title}</span>
      <span className="text-muted line-clamp-3 text-[12px] leading-relaxed">
        {branch.rationale}
      </span>
      {recommended && reason ? (
        <span className="border-line mt-1 border-l-2 pl-2 text-[12px] leading-relaxed">
          <span className="text-muted font-semibold">Why: </span>
          {reason}
        </span>
      ) : null}
      {p ? (
        <>
          <span className="mt-auto flex items-baseline gap-2 pt-2">
            <span className={`figure text-[26px] ${p.cashAfterCents < 0 ? 'text-block' : ''}`}>
              {usdShort(p.cashAfterCents)}
            </span>
            <span className="text-muted text-[12px]">cash left</span>
          </span>
          <span className="border-line text-muted flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-t pt-2.5 text-[12px]">
            <span>{usdShort(p.outflowCents)} paid</span>
            <span>{usdShort(p.lateFeesCents)} fees</span>
            <span>
              {approvals} sign-off{approvals === 1 ? '' : 's'}
            </span>
          </span>
        </>
      ) : (
        <span className="text-muted border-line mt-auto border-t pt-2.5 text-[12px]">
          Numbers not run yet.
        </span>
      )}
      {branch.approvedPlanHash ? (
        <span className="border-line border-t pt-2.5">
          <AuthorizationSeal hash={branch.approvedPlanHash} size={30} />
        </span>
      ) : null}
    </button>
  );
}

function Stat({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted text-[11px]">{name}</span>
      <span className="text-[12px]">{children}</span>
    </div>
  );
}

// the compact card used as a node in the branch map
export function BranchCard({
  branch,
  selected,
  onSelect,
  width = 264,
}: {
  branch: Branch;
  selected: boolean;
  onSelect?: () => void;
  width?: number;
}) {
  const p = branch.projection;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ width }}
      className={`rounded-[10px] border-[1.5px] p-3 ${frame(branch, selected)}`}
    >
      <div className="flex items-start gap-2">
        <span className="border-line bg-surface flex h-7 min-w-7 shrink-0 items-center justify-center rounded-[6px] border px-1 text-[13px] font-extrabold">
          {branch.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-extrabold">{branch.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Tag tone={statusOf(branch.status).tone}>{statusOf(branch.status).text}</Tag>
            <SourcePill source={branch.source} />
          </div>
        </div>
      </div>

      {p ? (
        <div className="border-line mt-2.5 space-y-0.5 border-t pt-2">
          <Stat name="Cash left">
            <Money cents={p.cashAfterCents} className="font-medium" />
          </Stat>
          <Stat name="Deferred">
            <span className="money">{usdShort(p.deferredCents)}</span>
          </Stat>
          <Stat name="Late fees">
            <span className="money">{usdShort(p.lateFeesCents)}</span>
          </Stat>
          <Stat name="Sign-offs needed">
            <span className="money">{branch.risk?.approvalsNeeded ?? 0}</span>
          </Stat>
        </div>
      ) : (
        <p className="text-muted border-line mt-2.5 border-t pt-2 text-[12px]">
          Numbers not run yet.
        </p>
      )}

      {branch.approvedPlanHash ? (
        <div className="border-line mt-2.5 border-t pt-2.5">
          <AuthorizationSeal hash={branch.approvedPlanHash} size={30} />
        </div>
      ) : null}
    </button>
  );
}
