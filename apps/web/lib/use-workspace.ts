'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailure, ENGINE_URL, setCsrf } from './api';
import type { AuditEvent, Health, RunView, Scenario } from './types';

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

// everything the workspace shows is server state. the page asks for it again whenever the engine
// says something happened, so a reload always lands on the same screen.
export function useWorkspace() {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [live, setLive] = useState(false);
  const runId = view?.run.id;
  // the run on screen. an action can open a new run halfway through, so this is read when the
  // action ends, not when it started.
  const shown = useRef<number | undefined>(undefined);

  const refresh = useCallback(async (id?: number) => {
    const [scenarioResponse, healthResponse] = await Promise.all([
      api<{ scenario: Scenario }>('GET', '/api/scenario'),
      api<Health>('GET', '/api/health'),
    ]);
    setScenario(scenarioResponse.scenario);
    setHealth(healthResponse);
    let target = id;
    if (target === undefined) {
      const { runs } = await api<{ runs: { id: number }[] }>('GET', '/api/runs');
      target = runs[0]?.id;
    }
    shown.current = target;
    setView(target === undefined ? null : await api<RunView>('GET', `/api/runs/${target}`));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ email: string | null; csrfToken?: string }>('GET', '/api/auth/me');
        if (me.csrfToken) setCsrf(me.csrfToken);
        setEmail(me.email);
        // run history and the books are private now. sign-in fetches them.
        if (me.email) await refresh();
      } catch (error) {
        setEmail(null);
        setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    })();
  }, [refresh]);

  // live events for the open run. refetch on each burst instead of patching state by hand.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (runId === undefined) return;
    setEvents([]);
    const stream = new EventSource(`${ENGINE_URL}/api/runs/${runId}/events`, {
      withCredentials: true,
    });
    stream.addEventListener('audit', (message) => {
      const event = JSON.parse((message as MessageEvent).data) as AuditEvent;
      setEvents((list) => (list.some((item) => item.id === event.id) ? list : [...list, event]));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(runId).catch(() => undefined), 150);
    });
    stream.onopen = () => setLive(true);
    stream.onerror = () => setLive(false);
    return () => {
      stream.close();
      setLive(false);
    };
  }, [runId, refresh]);

  // runs one action, shows what failed and what happens next if it does
  const act = useCallback(
    async (label: string, work: () => Promise<unknown>) => {
      setBusy(label);
      setNotice(null);
      try {
        await work();
        await refresh(shown.current);
        return true;
      } catch (error) {
        const text =
          error instanceof ApiFailure || error instanceof Error ? error.message : String(error);
        // the agent's proposal didn't survive FORK's checks. say so, and say what to do.
        const rejected = error instanceof ApiFailure && error.code === 'INVALID_PROPOSAL';
        const reasons = rejected && Array.isArray(error.details) ? error.details.join(' ') : '';
        setNotice({
          kind: 'error',
          text: rejected
            ? `The agent proposed a plan FORK could not accept: ${text}. ${reasons} Nothing was changed. Explore options again for a fresh proposal.`
            : text,
        });
        await refresh(shown.current).catch(() => undefined);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const signIn = (password: string, as: string) =>
    act('Signing in', async () => {
      const session = await api<{ email: string; csrfToken: string }>('POST', '/api/auth/login', {
        email: as,
        password,
      });
      setCsrf(session.csrfToken);
      setEmail(session.email);
    });

  // proposes plans and runs the numbers on each, so the first thing on screen is a comparison
  const explore = () =>
    act('Drafting plans', async () => {
      let id = view && view.branches.length === 0 ? view.run.id : undefined;
      if (id === undefined) {
        id = (await api<RunView>('POST', '/api/runs')).run.id;
        await refresh(id);
      }
      await api('POST', `/api/runs/${id}/propose`);
      await refresh(id);
      setBusy('Running the numbers');
      const { branches } = await api<RunView>('GET', `/api/runs/${id}`);
      for (const branch of branches) {
        if (branch.status === 'PROPOSED') await api('POST', `/api/branches/${branch.id}/simulate`);
      }
    });

  const simulateAll = () =>
    act('Running the numbers', async () => {
      for (const branch of view?.branches ?? []) {
        if (branch.status === 'PROPOSED') await api('POST', `/api/branches/${branch.id}/simulate`);
      }
    });

  const post = (label: string, path: string) => act(label, () => api('POST', path));

  return {
    email,
    scenario,
    view,
    health,
    events,
    busy,
    notice,
    live,
    dismiss: () => setNotice(null),
    signIn,
    explore,
    simulateAll,
    authorize: (branchId: string) => post('Approving', `/api/branches/${branchId}/authorize`),
    commit: (branchId: string) => post('Starting', `/api/branches/${branchId}/commit`),
    cancel: (branchId: string) => post('Cancelling', `/api/branches/${branchId}/cancel`),
    tamper: (branchId: string) =>
      post('Running tamper test', `/api/branches/${branchId}/tamper-test`),
    replan: (branchId: string) => post('Replanning', `/api/branches/${branchId}/replan`),
    inject: () =>
      runId === undefined
        ? Promise.resolve(false)
        : post('Adding the message', `/api/runs/${runId}/inject`),
    openRun: (id: number) => act('Opening run', () => refresh(id)),
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
