'use client';

import { LayoutGrid, Network, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BillsTable, SituationBar } from '@/components/books';
import { BranchCanvas } from '@/components/branch-canvas';
import { PlanCard } from '@/components/branch-card';
import {
  CommandPalette,
  Shell,
  SignIn,
  StepBar,
  VerdictIsland,
  type PaletteAction,
  type Stage,
} from '@/components/chrome';
import { Compare } from '@/components/compare';
import { AuthorizeDialog, DecisionPanel, payments } from '@/components/inspector';
import { Button, buttonClass, Card, Insight } from '@/components/primitives';
import { ActivityFeed, Safeguards } from '@/components/rail';
import { DONE } from '@/lib/describe';
import { usdShort } from '@/lib/format';
import type { Branch, RunView } from '@/lib/types';
import { useWorkspace, type Workspace } from '@/lib/use-workspace';

const STOPPED: Branch['status'][] = ['BLOCKED', 'PARTIALLY_COMMITTED', 'CANCELLED', 'STALE'];

function stageOf(view: RunView | null): Stage {
  const branches = view?.branches ?? [];
  if (!branches.length || branches.some((branch) => branch.status === 'PROPOSED')) return 'Explore';
  if (branches.some((branch) => branch.status === 'APPROVED' || branch.status === 'COMMITTING'))
    return 'Execute';
  const finished = branches.some((branch) => DONE.includes(branch.status));
  const openReplan = branches.some((branch) => branch.parentId && branch.status === 'SIMULATED');
  return finished && !openReplan ? 'Review' : 'Approve';
}

function defaultBranch(view: RunView | null): string | null {
  const branches = view?.branches ?? [];
  const feasible = branches.filter((branch) => branch.status === 'SIMULATED');
  const pick =
    branches.find((branch) => branch.status === 'COMMITTING' || branch.status === 'APPROVED') ??
    branches.find(
      (branch) => branch.parentId && ['PROPOSED', 'SIMULATED'].includes(branch.status),
    ) ??
    branches.find((branch) => DONE.includes(branch.status)) ??
    bestOf(feasible) ??
    branches[0];
  return pick?.id ?? null;
}

// the feasible plan that leaves the most cash. a fact about the numbers, not a recommendation.
function bestOf(branches: Branch[]): Branch | undefined {
  return branches
    .filter((branch) => branch.projection && branch.feasibility?.ok !== false)
    .sort((a, b) => b.projection!.cashAfterCents - a.projection!.cashAfterCents)[0];
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// what the page says at the top. it changes with the step, so it always answers "what now?"
function headline(view: RunView | null, stage: Stage, short: boolean): [string, string] {
  const branches = view?.branches ?? [];
  if (!branches.length) {
    return [
      short ? "You can't pay everything this week." : "This week's bills need a plan.",
      'Let the agent draft a few ways to handle it. FORK runs the numbers on a copy of the books, and nothing is paid until you approve one plan.',
    ];
  }
  const active =
    branches.find((branch) => ['APPROVED', 'COMMITTING'].includes(branch.status)) ??
    branches.find((branch) => DONE.includes(branch.status));
  if (stage === 'Explore')
    return [
      'A new plan needs its numbers run.',
      'A proposal is only an idea. Run the numbers to see what it would do, then decide whether to approve it.',
    ];
  if (stage === 'Approve') {
    const count = branches.filter((branch) => !branch.parentId).length;
    return [
      `${count} ways forward. Pick one.`,
      'Compare what each plan pays, defers and costs. Approve the one you want. The agent cannot change it afterwards.',
    ];
  }
  if (stage === 'Execute') {
    return active?.status === 'COMMITTING'
      ? [
          `Executing plan ${active.label}.`,
          'Each approved payment is checked by ArmorIQ, then paid. Every call shows up in the activity below as it happens.',
        ]
      : [
          `Plan ${active?.label} is approved. Nothing has moved yet.`,
          'Execute it to send each payment through ArmorIQ. This is also the moment to test the safeguards.',
        ];
  }
  const ending =
    active?.status === 'COMMITTED'
      ? 'is done.'
      : active?.status === 'CANCELLED'
        ? 'was cancelled.'
        : 'was stopped early.';
  return [
    `Plan ${active?.label} ${ending}`,
    'The receipt shows what was paid, what was stopped, and the proof behind both.',
  ];
}

// one main button, and it always says what it will do. the hint says what happens after.
function nextStep(
  ws: Workspace,
  stage: Stage,
  branch: Branch | null,
): { action: ReactNode; hint: string } {
  const busy = Boolean(ws.busy);
  const view = ws.view;
  const health = ws.health;

  if (stage === 'Explore') {
    const fresh = !view?.branches.length;
    return {
      action: (
        <Button
          variant="primary"
          className="w-full"
          disabled={busy}
          onClick={() => (fresh ? ws.explore() : ws.simulateAll())}
        >
          {busy ? `${ws.busy}…` : fresh ? 'Explore options' : 'Run the numbers'}
        </Button>
      ),
      hint: fresh
        ? 'Drafting plans moves no money. A real model writes them, so it can take a few minutes.'
        : 'A new proposal is not an approval. Running the numbers changes nothing in the books.',
    };
  }

  if (stage === 'Approve') {
    if (branch?.status === 'SIMULATED' && ws.scenario && view) {
      return {
        action: (
          <AuthorizeDialog
            branch={branch}
            items={payments(branch, ws.scenario, view)}
            busy={busy}
            onConfirm={() => ws.authorize(branch.id)}
          />
        ),
        hint: 'You stay in control. Approving freezes these exact payments. It does not send them.',
      };
    }
    const reason =
      branch?.status === 'INFEASIBLE'
        ? `Plan ${branch.label} was rejected by FORK. Pick a plan that keeps the reserve.`
        : 'Select a plan that can still be approved.';
    return {
      action: (
        <Button variant="primary" className="w-full" disabled reason={reason}>
          {branch ? `Can't approve plan ${branch.label}` : 'Select a plan'}
        </Button>
      ),
      hint: reason,
    };
  }

  if (stage === 'Execute') {
    const active = view?.branches.find((item) => ['APPROVED', 'COMMITTING'].includes(item.status));
    if (active?.status === 'COMMITTING') {
      return {
        action: (
          <div className="flex flex-col gap-2">
            <Button variant="primary" className="w-full" disabled>
              Executing plan {active.label}…
            </Button>
            <Button className="w-full" onClick={() => ws.cancel(active.id)} disabled={busy}>
              Stop after this step
            </Button>
          </div>
        ),
        hint: 'The runner is working through the approved steps, one call at a time.',
      };
    }
    const ready = health?.armoriqConfigured && health.armoriqReachable && health.mcpReachable;
    const reason = !health?.armoriqConfigured
      ? (health?.reason ?? 'ArmorIQ is not configured. Nothing can be committed.')
      : !health.armoriqReachable
        ? "ArmorIQ didn't respond. Nothing was paid. Execution is paused."
        : 'The payment server is not reachable. Execution is paused.';
    return {
      action: (
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || !ready || !active}
          reason={!ready ? reason : undefined}
          onClick={() => active && ws.commit(active.id)}
        >
          {busy ? `${ws.busy}…` : `Execute plan ${active?.label ?? ''}`}
        </Button>
      ),
      hint: ready
        ? 'Each payment is sent through ArmorIQ to the sandbox payment server. Anything outside the approved plan is refused.'
        : reason,
    };
  }

  const stopped = branch && STOPPED.includes(branch.status);
  return {
    action: (
      <div className="flex flex-col gap-2">
        <Link
          href={`/app/runs/${view?.run.id ?? ''}`}
          className={`${buttonClass('primary')} w-full`}
        >
          View the receipt
        </Link>
        {stopped ? (
          <Button className="w-full" disabled={busy} onClick={() => ws.replan(branch.id)}>
            Replan from here
          </Button>
        ) : null}
        <Button variant="quiet" className="w-full" disabled={busy} onClick={() => ws.explore()}>
          Start a new decision
        </Button>
      </div>
    ),
    hint: stopped
      ? 'Replanning asks the agent for a new plan from where this one stopped. It needs a new approval.'
      : 'This decision is closed. Its record cannot be edited.',
  };
}

function Notice({ ws }: { ws: Workspace }) {
  if (!ws.notice) return null;
  return (
    <div
      role="alert"
      className="border-block text-text flex items-start justify-between gap-3 rounded-[10px] border bg-[color-mix(in_srgb,var(--block)_9%,var(--surface))] px-4 py-3 text-[13px]"
    >
      <span>{ws.notice.text}</span>
      <button
        type="button"
        onClick={ws.dismiss}
        aria-label="Dismiss"
        className="hover:bg-raised rounded-[6px] p-0.5"
      >
        <X size={15} strokeWidth={1.75} />
      </button>
    </div>
  );
}

export default function StudioPage() {
  const ws = useWorkspace();
  const [palette, setPalette] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [mapView, setMapView] = useState(false);
  const phone = !useMedia('(min-width: 1024px)');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = ws.view;
  const stage = stageOf(view);
  const selectedId = view?.branches.some((branch) => branch.id === picked)
    ? picked
    : defaultBranch(view);
  const selected = view?.branches.find((branch) => branch.id === selectedId) ?? null;
  const select = useCallback((id: string) => setPicked(id), []);
  const steps = useMemo(() => view?.steps ?? [], [view]);
  const branches = useMemo(() => view?.branches ?? [], [view]);

  if (ws.email === undefined) {
    return (
      <Shell active="Studio">
        <p className="text-muted p-8 text-[13px]">Loading the studio…</p>
      </Shell>
    );
  }

  if (ws.email === null || !ws.scenario) {
    return (
      <Shell active="Studio" health={ws.health}>
        <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col items-start gap-4 px-4 py-12 lg:px-8">
          <Notice ws={ws} />
          {ws.email === null ? <SignIn ws={ws} /> : null}
        </main>
      </Shell>
    );
  }

  const live = ws.scenario;
  const base = view?.snapshot.state ?? live;
  const due = base.invoices.reduce((sum, item) => sum + item.amountCents - item.paidCents, 0);
  const [title, lead] = headline(view, stage, due > base.cashCents);
  const { action, hint } = nextStep(ws, stage, selected);
  const empty = branches.length === 0;
  const best =
    stage === 'Approve' ? bestOf(branches.filter((b) => b.status === 'SIMULATED')) : null;
  const simulated = branches.some((branch) => branch.projection);
  const vendorName = (id: unknown) =>
    base.vendors.find((item) => item.id === id)?.name ?? String(id ?? '');
  const infeasible = branches.filter((branch) => branch.status === 'INFEASIBLE').length;

  const panel = (
    <DecisionPanel
      branch={selected}
      scenario={base}
      view={view}
      action={empty || phone ? null : action}
      hint={hint}
    />
  );

  const actions: PaletteAction[] = [
    {
      name: 'Inject hostile message (security test)',
      run: view ? () => void ws.inject() : undefined,
      reason: view ? undefined : 'Explore options first',
    },
    {
      name: 'Run tamper test (security test)',
      run: selected?.approvedPlanHash ? () => void ws.tamper(selected.id) : undefined,
      reason: selected?.approvedPlanHash ? undefined : 'Approve a plan first',
    },
    { name: 'Start a new decision', run: () => void ws.explore() },
    {
      name: 'Open the ArmorIQ console',
      run: () => window.open('https://platform.armoriq.ai', '_blank', 'noreferrer'),
    },
    { name: 'Reset the demo', reason: 'Run pnpm reset in the terminal, then restart the engine' },
  ];

  return (
    <Shell active="Studio" health={ws.health}>
      <VerdictIsland events={ws.events} />
      <main
        className={`mx-auto w-full max-w-[1240px] flex-1 px-4 pt-9 lg:px-8 ${phone && !empty ? 'pb-28' : 'pb-20'}`}
      >
        <div className="eyebrow">
          Kettle &amp; Pine / Weekly treasury
          {view ? ` / Run #${String(view.run.id).padStart(4, '0')}` : ''}
        </div>
        <h1 className="mt-2.5 max-w-[22ch] text-[32px] leading-[1.08] font-extrabold sm:text-[40px]">
          {title}
        </h1>
        <p className="text-muted mt-3 max-w-[64ch] text-[14px] leading-relaxed">{lead}</p>

        <div className="mt-6">
          <StepBar stage={stage} />
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <SituationBar base={base} live={live} />
          <Notice ws={ws} />
        </div>

        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(300px,0.85fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card
              title={empty ? 'No plans yet' : 'Choose how to handle it'}
              hint={
                empty
                  ? 'The agent proposes up to three ways to handle these invoices.'
                  : `Every plan starts from the same ${usdShort(base.cashCents)}.`
              }
              action={
                empty || phone ? null : (
                  <div
                    className="border-line bg-bg flex rounded-[8px] border p-0.5"
                    role="group"
                    aria-label="View"
                  >
                    {(
                      [
                        [false, 'Cards', LayoutGrid],
                        [true, 'Branch map', Network],
                      ] as const
                    ).map(([value, name, Icon]) => (
                      <button
                        key={name}
                        type="button"
                        aria-pressed={mapView === value}
                        onClick={() => setMapView(value)}
                        className={`flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-bold ${mapView === value ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'}`}
                      >
                        <Icon size={13} strokeWidth={2} aria-hidden />
                        {name}
                      </button>
                    ))}
                  </div>
                )
              }
            >
              {empty ? (
                ws.busy ? (
                  <div role="status">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      {['A', 'B', 'C'].map((letter) => (
                        <div
                          key={letter}
                          className="border-line bg-bg shimmer h-[150px] rounded-[12px] border border-dashed p-4"
                        >
                          <span className="border-line text-muted flex h-7 w-7 items-center justify-center rounded-[6px] border text-[13px] font-extrabold">
                            {letter}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[13px] font-bold">{ws.busy}…</p>
                    <p className="text-muted text-[12px]">
                      A real model drafts these, so this can take a few minutes. No money moves.
                    </p>
                  </div>
                ) : (
                  <div className="border-line bg-bg flex flex-col items-start gap-4 rounded-[12px] border border-dashed p-6">
                    <p className="max-w-[52ch] text-[14px] leading-relaxed">
                      Each plan is tried against a frozen copy of the books, so you can compare
                      outcomes side by side before a single payment is made.
                    </p>
                    <div className="w-full sm:w-auto sm:min-w-[220px]">{action}</div>
                  </div>
                )
              ) : mapView && !phone ? (
                <div className="border-line bg-bg h-[460px] overflow-hidden rounded-[12px] border">
                  <BranchCanvas
                    branches={branches}
                    steps={steps}
                    cashCents={base.cashCents}
                    selectedId={selectedId}
                    onSelect={select}
                  />
                </div>
              ) : (
                <ol
                  aria-label="Plans"
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                >
                  {branches.map((branch) => (
                    <li key={branch.id}>
                      <PlanCard
                        branch={branch}
                        selected={branch.id === selectedId}
                        best={branch.id === best?.id}
                        onSelect={() => select(branch.id)}
                      />
                    </li>
                  ))}
                </ol>
              )}
              {simulated ? (
                <div className="mt-4">
                  <Insight tone="good">
                    <b>These numbers are calculated by FORK, not guessed by the agent.</b>{' '}
                    Simulating a plan never touches the ledger.
                    {infeasible
                      ? ` ${infeasible} plan${infeasible === 1 ? ' was' : 's were'} rejected because the money isn't there.`
                      : ''}
                  </Insight>
                </div>
              ) : null}
            </Card>

            {/* on a phone the selected plan sits right under the cards */}
            {phone ? panel : null}

            {simulated ? (
              <Compare
                branches={branches}
                scenario={base}
                selectedId={selectedId}
                onSelect={select}
              />
            ) : null}

            <Card
              flush
              title="Which bills get paid?"
              hint={
                selected?.projection
                  ? `What plan ${selected.label} does with each invoice.`
                  : 'The invoices due this week.'
              }
            >
              <BillsTable base={base} live={live} branch={selected} view={view} />
            </Card>

            {view ? (
              <Card
                flush
                title="What actually happened"
                hint="Every tool call, in order: what it meant, who made it, and what ArmorIQ answered."
              >
                <ActivityFeed steps={steps} events={ws.events} vendorName={vendorName} />
              </Card>
            ) : null}

            {view ? (
              <Card
                title="Test the safeguards"
                hint="Try to push an approved plan off course. Both tests go through the real ArmorIQ path."
              >
                <Safeguards ws={ws} branch={selected} messages={view.messages} />
              </Card>
            ) : null}
          </div>

          {phone ? null : panel}
        </div>
      </main>

      {phone && !empty ? (
        <div className="border-line bg-surface fixed inset-x-0 bottom-0 z-30 border-t p-3">
          {action}
        </div>
      ) : null}

      <CommandPalette open={palette} onOpenChange={setPalette} actions={actions} />
    </Shell>
  );
}
