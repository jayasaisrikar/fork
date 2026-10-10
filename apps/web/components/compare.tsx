'use client';

import { Tabs } from 'radix-ui';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
} from 'recharts';
import { day, usd, usdShort } from '@/lib/format';
import type { Branch, Scenario } from '@/lib/types';
import { Chip, Money } from './primitives';

const tab =
  'text-muted data-[state=active]:text-text data-[state=active]:border-accent -mb-px h-9 border-b-2 border-transparent px-3 text-[12px] font-medium';
const th = 'label px-3 py-2 text-right font-normal first:text-left';
const td = 'money px-3 text-right';

function best(values: number[], pick: 'max' | 'min') {
  return pick === 'max' ? Math.max(...values) : Math.min(...values);
}

function CompareTable({
  branches,
  selectedId,
  onSelect,
}: {
  branches: Branch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const rows = branches.filter((branch) => branch.projection);
  if (!rows.length)
    return <p className="text-muted p-3 text-[13px]">Simulate the branches to compare them.</p>;
  const column = (get: (branch: Branch) => number, pick: 'max' | 'min') => {
    const target = best(rows.map(get), pick);
    return (branch: Branch) => (get(branch) === target ? 'text-text' : 'text-muted');
  };
  const cash = column((b) => b.projection!.cashAfterCents, 'max');
  const low = column((b) => b.projection!.lowestCashCents, 'max');
  const fees = column((b) => b.projection!.lateFeesCents, 'min');
  const deferred = column((b) => b.projection!.deferredCents, 'min');
  const approvals = column((b) => b.risk?.approvalsNeeded ?? 0, 'min');

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[620px] border-collapse text-[13px]">
        <thead>
          <tr className="border-line border-b">
            <th className={th}>Branch</th>
            <th className={th}>Cash after</th>
            <th className={th}>Lowest cash</th>
            <th className={th}>Reserve</th>
            <th className={th}>Late fees</th>
            <th className={th}>Deferred</th>
            <th className={th}>Approvals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((branch) => (
            <tr
              key={branch.id}
              onClick={() => onSelect(branch.id)}
              className={`border-line h-9 cursor-pointer border-b last:border-0 ${branch.id === selectedId ? 'bg-raised' : 'hover:bg-raised'}`}
            >
              <td className="px-3 whitespace-nowrap">
                <span className="font-display mr-2 font-extrabold">{branch.label}</span>
                {branch.title}
              </td>
              <td className={`${td} ${cash(branch)}`}>
                <Money cents={branch.projection!.cashAfterCents} />
              </td>
              <td className={`${td} ${low(branch)}`}>
                <Money cents={branch.projection!.lowestCashCents} />
              </td>
              <td className="px-3 text-right">
                {branch.projection!.reserveBreached ? (
                  <Chip tone="text">Breach</Chip>
                ) : (
                  <span className="text-muted">Held</span>
                )}
              </td>
              <td className={`${td} ${fees(branch)}`}>{usd(branch.projection!.lateFeesCents)}</td>
              <td className={`${td} ${deferred(branch)}`}>
                {usd(branch.projection!.deferredCents)}
              </td>
              <td className={`${td} ${approvals(branch)}`}>{branch.risk?.approvalsNeeded ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CashPath({
  branches,
  selectedId,
  reserveCents,
}: {
  branches: Branch[];
  selectedId: string | null;
  reserveCents: number;
}) {
  const rows = branches.filter((branch) => branch.projection);
  if (!rows.length)
    return (
      <p className="text-muted p-3 text-[13px]">Simulate the branches to see their cash paths.</p>
    );
  const dates = rows[0]!.projection!.cashPath.map((point) => point.date);
  const data = dates.map((date, i) => ({
    date,
    ...Object.fromEntries(
      rows.map((branch) => [branch.label, branch.projection!.cashPath[i]?.cashCents ?? 0]),
    ),
  }));
  const mono = { fontFamily: 'var(--font-plex-mono)', fontSize: 11, fill: 'var(--muted)' };

  return (
    <div
      className="h-[220px] w-full p-2"
      role="img"
      aria-label="Projected cash over 14 days for each branch"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 64, bottom: 0, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="date"
            tickFormatter={day}
            tick={mono}
            tickLine={false}
            axisLine={{ stroke: 'var(--line)' }}
            interval={2}
          />
          <YAxis
            tickFormatter={(value: number) => usdShort(value)}
            tick={mono}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <ReferenceLine
            y={reserveCents}
            stroke="var(--muted)"
            strokeDasharray="4 4"
            label={{
              value: `${usdShort(reserveCents)} reserve`,
              position: 'insideBottomLeft',
              ...mono,
            }}
          />
          <Tooltip
            cursor={{ stroke: 'var(--line)' }}
            contentStyle={{
              background: 'var(--raised)',
              border: '1px solid var(--line)',
              borderRadius: 4,
              fontFamily: 'var(--font-plex-mono)',
              fontSize: 12,
            }}
            labelFormatter={(label) => day(String(label))}
            formatter={(value, name) => [usd(Number(value)), `Branch ${name}`]}
          />
          {rows.map((branch) => {
            const selected = branch.id === selectedId;
            return (
              <Line
                key={branch.id}
                type="stepAfter"
                dataKey={branch.label}
                stroke={selected ? 'var(--accent)' : 'var(--muted)'}
                strokeWidth={selected ? 2 : 1}
                isAnimationActive={false}
                dot={false}
              />
            );
          })}
          {/* name each line at its right end, no legend box. only the selected one gets a dot. */}
          {rows.map((branch) => {
            const selected = branch.id === selectedId;
            const end = branch.projection!.cashAfterCents;
            return (
              <ReferenceDot
                key={branch.id}
                x={dates.at(-1)}
                y={end}
                r={selected ? 3 : 0}
                fill="var(--accent)"
                stroke="none"
                label={{
                  value: selected ? `${branch.label} ${usdShort(end)}` : branch.label,
                  position: 'right',
                  ...mono,
                  fill: selected ? 'var(--accent)' : 'var(--muted)',
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Diff({ branches, scenario }: { branches: Branch[]; scenario: Scenario }) {
  const rows = branches.filter((branch) => branch.projection);
  const [left, setLeft] = useState<string | undefined>();
  const [right, setRight] = useState<string | undefined>();
  if (rows.length < 2)
    return (
      <p className="text-muted p-3 text-[13px]">Two simulated branches are needed for a diff.</p>
    );
  const a = rows.find((branch) => branch.id === left) ?? rows[0]!;
  const b = rows.find((branch) => branch.id === right) ?? rows[1]!;
  const select = 'border-line bg-surface h-7 rounded-[4px] border px-2 text-[12px]';
  const vendor = (id: string) => scenario.vendors.find((item) => item.id === id)?.name ?? id;

  return (
    <div className="overflow-auto">
      <div className="flex items-center gap-2 p-3">
        <label className="text-muted text-[12px]" htmlFor="diff-a">
          Compare
        </label>
        <select
          id="diff-a"
          className={select}
          value={a.id}
          onChange={(event) => setLeft(event.target.value)}
        >
          {rows.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.label}: {branch.title}
            </option>
          ))}
        </select>
        <label className="text-muted text-[12px]" htmlFor="diff-b">
          with
        </label>
        <select
          id="diff-b"
          className={select}
          value={b.id}
          onChange={(event) => setRight(event.target.value)}
        >
          {rows.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.label}: {branch.title}
            </option>
          ))}
        </select>
      </div>
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead>
          <tr className="border-line border-y">
            <th className={th}>Invoice</th>
            <th className={th}>{a.label} pays</th>
            <th className={th}>{a.label} leaves</th>
            <th className={th}>{b.label} pays</th>
            <th className={th}>{b.label} leaves</th>
          </tr>
        </thead>
        <tbody>
          {a.projection!.lines.map((line) => {
            const other = b.projection!.lines.find((item) => item.invoiceId === line.invoiceId);
            const differs = other?.paidCents !== line.paidCents;
            return (
              <tr key={line.invoiceId} className="border-line h-9 border-b last:border-0">
                <td className="px-3">
                  <span className="text-muted mr-2 font-mono text-[12px]">{line.invoiceId}</span>
                  {vendor(line.vendorId)}
                </td>
                <td className={`${td} ${differs ? 'text-text' : 'text-muted'}`}>
                  {usd(line.paidCents)}
                </td>
                <td className={`${td} text-muted`}>{usd(line.remainingCents)}</td>
                <td className={`${td} ${differs ? 'text-text' : 'text-muted'}`}>
                  {usd(other?.paidCents ?? 0)}
                </td>
                <td className={`${td} text-muted`}>{usd(other?.remainingCents ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Compare({
  branches,
  scenario,
  selectedId,
  onSelect,
}: {
  branches: Branch[];
  scenario: Scenario;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Tabs.Root
      defaultValue="table"
      className="border-line bg-surface flex min-h-0 flex-col rounded-[6px] border"
    >
      <Tabs.List
        className="border-line flex shrink-0 items-center border-b px-1"
        aria-label="Compare branches"
      >
        <span className="label px-2">Compare</span>
        <Tabs.Trigger value="table" className={tab}>
          Table
        </Tabs.Trigger>
        <Tabs.Trigger value="path" className={tab}>
          Cash path
        </Tabs.Trigger>
        <Tabs.Trigger value="diff" className={tab}>
          Diff
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="table" className="min-h-0 flex-1 overflow-auto">
        <CompareTable branches={branches} selectedId={selectedId} onSelect={onSelect} />
      </Tabs.Content>
      <Tabs.Content value="path" className="min-h-0 flex-1">
        <CashPath
          branches={branches}
          selectedId={selectedId}
          reserveCents={scenario.reserveCents}
        />
      </Tabs.Content>
      <Tabs.Content value="diff" className="min-h-0 flex-1 overflow-auto">
        <Diff branches={branches} scenario={scenario} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
