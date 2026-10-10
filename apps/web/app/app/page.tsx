'use client';

import { Tabs, Tooltip } from 'radix-ui';
import { List, Network, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Books } from '@/components/books';
import { BranchCanvas, BranchList } from '@/components/branch-canvas';
import {
  CommandPalette,
  SignIn,
  Stepper,
  TopBar,
  VerdictIsland,
  type PaletteAction,
  type Stage,
} from '@/components/chrome';
import { Compare } from '@/components/compare';
import { AuthorizeDialog, Inspector, payments } from '@/components/inspector';
import { Button, Hint, Panel } from '@/components/primitives';
import { ExecutionRail } from '@/components/rail';
import type { Branch, RunView } from '@/lib/types';
import { useWorkspace, type Workspace } from '@/lib/use-workspace';

const DONE = ['COMMITTED', 'PARTIALLY_COMMITTED', 'BLOCKED', 'CANCELLED'];

function stageOf(view: RunView | null): Stage {
  const branches = view?.branches ?? [];
  if (!branches.length) return 'Fork';
  if (branches.some((branch) => branch.status === 'PROPOSED')) return 'Simulate';
  if (branches.some((branch) => branch.status === 'APPROVED' || branch.status === 'COMMITTING'))
    return 'Execute';
  const finished = branches.some((branch) => DONE.includes(branch.status));
  const openReplan = branches.some((branch) => branch.parentId && branch.status === 'SIMULATED');
  return finished && !openReplan ? 'Review' : 'Authorize';
}

function defaultBranch(view: RunView | null): string | null {
  const branches = view?.branches ?? [];
  const pick =
    branches.find((branch) => branch.status === 'COMMITTING' || branch.status === 'APPROVED') ??
    branches.find(
      (branch) => branch.parentId && ['PROPOSED', 'SIMULATED'].includes(branch.status),
    ) ??
    branches.find((branch) => DONE.includes(branch.status)) ??
    branches.find((branch) => branch.status === 'SIMULATED') ??
    branches[0];
  return pick?.id ?? null;
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

// one main button, and it always says what it will do. when it can't act, it says why.
function PrimaryAction({
  ws,
  stage,
  branch,
}: {
  ws: Workspace;
  stage: Stage;
  branch: Branch | null;
}) {
  const busy = Boolean(ws.busy);
  const health = ws.health;
  if (stage === 'Fork') {
    return (
      <Button variant="primary" disabled={busy} onClick={() => ws.propose()}>
        {busy ? ws.busy : 'Propose branches'}
      </Button>
    );
  }
  if (stage === 'Simulate') {
    return (
      <Button variant="primary" disabled={busy} onClick={() => ws.simulateAll()}>
        {busy ? ws.busy : 'Simulate branches'}
      </Button>
    );
  }
  if (stage === 'Authorize') {
    if (branch?.status === 'SIMULATED' && ws.scenario && ws.view) {
      return (
        <AuthorizeDialog
          compact
          branch={branch}
          items={payments(branch, ws.scenario, ws.view)}
          busy={busy}
          onConfirm={() => ws.authorize(branch.id)}
        />
      );
    }
    const reason =
      branch?.status === 'INFEASIBLE'
        ? `Branch ${branch.label} was rejected by FORK. Pick a branch that keeps the reserve.`
        : 'Select a simulated branch first.';
    return (
      <Button variant="primary" disabled reason={reason}>
        Authorize a branch
      </Button>
    );
  }
  if (stage === 'Execute') {
    const active = ws.view?.branches.find(
      (item) => item.status === 'APPROVED' || item.status === 'COMMITTING',
    );
    if (active?.status === 'COMMITTING') {
      return (
        <div className="flex gap-2">
          <Button onClick={() => ws.cancel(active.id)} disabled={busy}>
            Stop after this step
          </Button>
          <Button
            variant="primary"
            disabled
            reason="The runner is working through the approved steps."
          >
            Committing branch {active.label}
          </Button>
        </div>
      );
    }
    const ready = health?.armoriqConfigured && health.armoriqReachable && health.mcpReachable;
    const reason = !health?.armoriqConfigured
      ? (health?.reason ?? 'ArmorIQ is not configured. Nothing can be committed.')
      : !health.armoriqReachable
        ? "ArmorIQ didn't respond. Nothing was paid. Commit is paused."
        : 'The payment server is not reachable. Commit is paused.';
    return (
      <Button
        variant="primary"
        disabled={busy || !ready || !active}
        reason={!ready ? reason : undefined}
        onClick={() => active && ws.commit(active.id)}
      >
        {busy ? ws.busy : `Commit branch ${active?.label ?? ''}`}
      </Button>
    );
  }
  return (
    <Button
      variant="primary"
      disabled
      reason="The run record page is not built yet. Every call is in the execution rail below."
    >
      View run record
    </Button>
  );
}

function Notice({ ws }: { ws: Workspace }) {
  if (!ws.notice) return null;
  return (
    <div
      role="alert"
      className="border-line bg-raised flex items-start justify-between gap-3 rounded-[6px] border px-3 py-2 text-[13px]"
    >
      <span>{ws.notice.text}</span>
      <button
        type="button"
        onClick={ws.dismiss}
        aria-label="Dismiss"
        className="hover:bg-surface rounded-[4px] p-0.5"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export default function WorkspacePage() {
  const ws = useWorkspace();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [palette, setPalette] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [listView, setListView] = useState(false);
  const wide = useMedia('(min-width: 1280px)');
  const phone = !useMedia('(min-width: 768px)');

  useEffect(() => {
    const saved = window.localStorage.getItem('fork-app-theme');
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  const toggleTheme = () =>
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('fork-app-theme', next);
      return next;
    });

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

  const actions: PaletteAction[] = [
    {
      name: 'Inject hostile message (security test)',
      run: view ? () => void ws.inject() : undefined,
      reason: view ? undefined : 'Start a run first',
    },
    {
      name: 'Run tamper test (security test)',
      run: selected?.approvedPlanHash ? () => void ws.tamper(selected.id) : undefined,
      reason: selected?.approvedPlanHash ? undefined : 'Authorize a branch first',
    },
    { name: 'Start a new run', run: () => void ws.propose() },
    { name: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', run: toggleTheme },
    {
      name: 'Open the ArmorIQ console',
      run: () => window.open('https://platform.armoriq.ai', '_blank', 'noreferrer'),
    },
    { name: 'Reset the demo', reason: 'Run pnpm reset in the terminal, then restart the engine' },
  ];

  const shell = 'flex min-h-dvh flex-col bg-bg text-text font-sans text-[14px]';

  if (ws.email === undefined) {
    return (
      <div data-theme={theme} className={shell}>
        <p className="text-muted p-6 text-[13px]">Loading the workspace…</p>
      </div>
    );
  }

  if (ws.email === null) {
    return (
      <div data-theme={theme} className={shell}>
        <Tooltip.Provider>
          <TopBar ws={ws} theme={theme} onTheme={toggleTheme} onPalette={() => setPalette(true)} />
          <main className="flex flex-1 flex-col items-start gap-3 p-6">
            <Notice ws={ws} />
            <SignIn ws={ws} />
          </main>
        </Tooltip.Provider>
      </div>
    );
  }

  const canvasProps = {
    branches,
    steps,
    cashCents: view?.snapshot.state.cashCents ?? ws.scenario?.cashCents ?? 0,
    selectedId,
    onSelect: select,
  };
  const showList = phone || listView;

  const canvas = (
    <Panel
      title="Branch canvas"
      className={wide ? 'h-[420px] shrink-0' : phone ? '' : 'h-[460px]'}
      action={
        phone ? null : (
          <Hint text={listView ? 'Show the graph' : 'Show branches as a list'}>
            <button
              type="button"
              aria-pressed={listView}
              aria-label="List view"
              onClick={() => setListView(!listView)}
              className="hover:bg-raised flex h-6 items-center gap-1.5 rounded-[4px] px-1.5 text-[12px]"
            >
              {listView ? (
                <Network size={13} strokeWidth={1.5} />
              ) : (
                <List size={13} strokeWidth={1.5} />
              )}
              {listView ? 'Graph' : 'List view'}
            </button>
          </Hint>
        )
      }
    >
      {branches.length === 0 ? (
        <div className="flex h-full flex-col items-start justify-center gap-3 p-6">
          <p className="max-w-[46ch] text-[14px]">
            No branches yet. The planner proposes up to three ways to handle this week&apos;s
            invoices. Nothing is paid until you authorize one.
          </p>
          <Button variant="primary" disabled={Boolean(ws.busy)} onClick={() => ws.propose()}>
            {ws.busy ?? 'Propose branches'}
          </Button>
        </div>
      ) : showList ? (
        <BranchList {...canvasProps} />
      ) : (
        <BranchCanvas {...canvasProps} />
      )}
    </Panel>
  );

  const books = ws.scenario ? <Books scenario={ws.scenario} view={view} /> : null;
  const inspector = ws.scenario ? (
    <Inspector branch={selected} scenario={ws.scenario} view={view} ws={ws} />
  ) : null;
  const compare = ws.scenario ? (
    <Compare branches={branches} scenario={ws.scenario} selectedId={selectedId} onSelect={select} />
  ) : null;
  const rail = <ExecutionRail steps={steps} events={ws.events} branch={selected} ws={ws} />;
  const tab =
    'text-muted data-[state=active]:text-text data-[state=active]:border-accent -mb-px h-9 border-b-2 border-transparent px-3 text-[13px] font-medium';

  return (
    <div data-theme={theme} className={shell}>
      <Tooltip.Provider>
        <VerdictIsland events={ws.events} />
        <TopBar ws={ws} theme={theme} onTheme={toggleTheme} onPalette={() => setPalette(true)} />

        <div className="border-line flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
          <Stepper stage={stage} />
          {phone ? null : <PrimaryAction ws={ws} stage={stage} branch={selected} />}
        </div>

        <main className={`flex min-h-0 flex-1 flex-col gap-3 p-3 ${phone ? 'pb-20' : ''}`}>
          <Notice ws={ws} />
          {wide ? (
            <>
              <div className="grid h-[660px] shrink-0 grid-cols-[288px_minmax(0,1fr)_360px] gap-3">
                <Panel title="Books & inputs">{books}</Panel>
                <div className="flex min-h-0 flex-col gap-3">
                  {canvas}
                  <div className="flex min-h-0 flex-1 flex-col">{compare}</div>
                </div>
                <Panel title="Inspector">{inspector}</Panel>
              </div>
              {rail}
            </>
          ) : (
            <>
              {canvas}
              {compare}
              <Tabs.Root
                defaultValue="inspector"
                className="border-line bg-surface rounded-[6px] border"
              >
                <Tabs.List className="border-line flex border-b px-1" aria-label="Details">
                  <Tabs.Trigger value="books" className={tab}>
                    Books
                  </Tabs.Trigger>
                  <Tabs.Trigger value="inspector" className={tab}>
                    Inspector
                  </Tabs.Trigger>
                  <Tabs.Trigger value="execution" className={tab}>
                    Execution
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="books">{books}</Tabs.Content>
                <Tabs.Content value="inspector">{inspector}</Tabs.Content>
                <Tabs.Content value="execution" className="p-2">
                  {rail}
                </Tabs.Content>
              </Tabs.Root>
            </>
          )}
        </main>

        {phone ? (
          <div className="border-line bg-surface fixed inset-x-0 bottom-0 z-30 flex justify-end border-t p-3">
            <PrimaryAction ws={ws} stage={stage} branch={selected} />
          </div>
        ) : null}

        <CommandPalette open={palette} onOpenChange={setPalette} actions={actions} />
      </Tooltip.Provider>
    </div>
  );
}
