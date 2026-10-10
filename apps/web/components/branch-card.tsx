'use client';

import { motion, useReducedMotion } from 'motion/react';
import { shortHash, usdShort } from '@/lib/format';
import type { Branch } from '@/lib/types';
import { Chip, Money, SourcePill } from './primitives';

const STATUS: Record<Branch['status'], string> = {
  PROPOSED: 'Proposed',
  SIMULATED: 'Simulated',
  APPROVED: 'Authorized',
  COMMITTING: 'Committing',
  COMMITTED: 'Committed',
  PARTIALLY_COMMITTED: 'Partially committed',
  BLOCKED: 'Blocked',
  CANCELLED: 'Cancelled',
  INFEASIBLE: 'Rejected by FORK',
  STALE: 'Stale',
};

export const statusText = (status: Branch['status']) => STATUS[status];

// a ring that draws itself once, when the CFO signs
export function AuthorizationSeal({ hash, size = 44 }: { hash: string; size?: number }) {
  const still = useReducedMotion();
  const radius = size / 2 - 3;
  const length = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-2" aria-label={`Authorized, plan hash ${hash}`}>
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
        <div className="text-accent text-[12px] font-semibold">Authorized</div>
        <div className="text-muted font-mono text-[11px]">{shortHash(hash)}</div>
      </div>
    </div>
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

// the same card is used in the graph, the list view and on the landing page
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
  const infeasible = branch.status === 'INFEASIBLE';
  const unsigned = branch.source === 'replan' && !branch.approvedPlanHash;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ width }}
      className={`bg-surface rounded-[6px] border p-3 text-left ${selected ? 'border-accent' : 'border-line'} ${unsigned ? 'border-dashed' : ''} ${infeasible ? 'hatch' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="border-line font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border text-[14px] font-extrabold">
          {branch.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{branch.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {infeasible ? (
              <Chip tone="text">{STATUS[branch.status]}</Chip>
            ) : (
              <Chip>{STATUS[branch.status]}</Chip>
            )}
            <SourcePill source={branch.source} />
          </div>
        </div>
      </div>

      {p ? (
        <div className="border-line mt-2.5 space-y-0.5 border-t pt-2">
          <Stat name="Cash after">
            <Money cents={p.cashAfterCents} className="font-medium" />
          </Stat>
          <Stat name="Deferred">
            <span className="money">{usdShort(p.deferredCents)}</span>
          </Stat>
          <Stat name="Late fees">
            <span className="money">{usdShort(p.lateFeesCents)}</span>
          </Stat>
          <Stat name="Approvals needed">
            <span className="money">{branch.risk?.approvalsNeeded ?? 0}</span>
          </Stat>
        </div>
      ) : (
        <p className="text-muted border-line mt-2.5 border-t pt-2 text-[12px]">
          Not simulated yet.
        </p>
      )}

      {branch.approvedPlanHash ? (
        <div className="border-line mt-2.5 border-t pt-2.5">
          <AuthorizationSeal hash={branch.approvedPlanHash} size={32} />
        </div>
      ) : null}
    </button>
  );
}
