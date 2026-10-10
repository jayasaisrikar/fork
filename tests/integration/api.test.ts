import { cashCents } from '@fork/db';
import { describe, expect, it } from 'vitest';
import { ADMIN_KEY, CFO, SCENARIO, world } from '../support/world';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function client(w: ReturnType<typeof world>) {
  let cookie = '';
  let csrf = '';

  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await w.app.request(path, {
      method,
      headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as Json,
      headers: response.headers,
    };
  }

  async function login(password = CFO.password) {
    const response = await call('POST', '/api/auth/login', { email: CFO.email, password });
    if (response.status === 200) {
      cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      csrf = response.body.csrfToken;
    }
    return response;
  }

  return { call, login, dropCsrf: () => (csrf = '') };
}

describe('engine API', () => {
  it('needs the CFO session and a CSRF token for anything that changes state', async () => {
    const w = world();
    const api = client(w);

    expect((await api.call('POST', '/api/runs')).status).toBe(401);
    expect((await api.login('wrong')).status).toBe(401);

    const loggedIn = await api.login();
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.headers.get('set-cookie')).toMatch(/HttpOnly/i);

    api.dropCsrf();
    const noCsrf = await api.call('POST', '/api/runs');
    expect(noCsrf).toMatchObject({
      status: 403,
      body: { code: 'BAD_CSRF', requestId: expect.any(String) },
    });
  });

  it('runs the whole journey: propose, simulate, authorize, commit, tamper test', async () => {
    const w = world();
    const api = client(w);
    await api.login();

    const scenario = await api.call('GET', '/api/scenario');
    expect(scenario.body.scenario.cashCents).toBe(5_000_000);

    const run = (await api.call('POST', '/api/runs')).body.run;
    const noKey = await api.call('POST', '/api/demo/fixture-branches', { runId: run.id });
    expect(noKey.status).toBe(403);
    const proposed = await api.call(
      'POST',
      '/api/demo/fixture-branches',
      { runId: run.id },
      { 'x-admin-key': ADMIN_KEY },
    );
    expect(
      proposed.body.branches.map((branch: Json) => [branch.label, branch.status, branch.source]),
    ).toEqual([
      ['A', 'PROPOSED', 'fixture'],
      ['B', 'PROPOSED', 'fixture'],
      ['C', 'PROPOSED', 'fixture'],
    ]);
    const [a, b] = proposed.body.branches;

    const simA = await api.call('POST', `/api/branches/${a.id}/simulate`);
    expect(simA.body.branch).toMatchObject({
      status: 'INFEASIBLE',
      projection: { cashAfterCents: -1_800_000 },
    });
    const simB = await api.call('POST', `/api/branches/${b.id}/simulate`);
    expect(simB.body.branch).toMatchObject({
      status: 'SIMULATED',
      projection: { cashAfterCents: 1_000_000, lateFeesCents: 50_500 },
    });

    const refused = await api.call('POST', `/api/branches/${a.id}/authorize`);
    expect(refused).toMatchObject({ status: 409, body: { code: 'INVALID_TRANSITION' } });

    const authorized = await api.call('POST', `/api/branches/${b.id}/authorize`);
    expect(authorized.body.steps).toHaveLength(9);

    const tamper = await api.call('POST', `/api/branches/${b.id}/tamper-test`);
    expect(tamper.body.steps.map((step: Json) => step.verdict)).toEqual(['block', 'allow']);

    const committed = await api.call('POST', `/api/branches/${b.id}/commit`);
    expect(committed.status).toBe(202);
    await w.engine.settled(committed.body.execution.id);

    const after = (await api.call('GET', `/api/runs/${run.id}`)).body;
    expect(after.branches.find((branch: Json) => branch.id === b.id).status).toBe('COMMITTED');
    expect(after.approvals[0].approvedPlanHash).toBe(authorized.body.approvedPlanHash);
    expect(
      after.executions.find((execution: Json) => execution.kind === 'commit').approvedPlanHash,
    ).toBe(authorized.body.approvedPlanHash);
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
    expect(JSON.stringify(after)).not.toContain('approvedExecutionRef');

    const audit = (await api.call('GET', `/api/audit?run=${run.id}&type=step.`)).body.events;
    expect(audit.length).toBeGreaterThan(9);
    const health = (await api.call('GET', '/api/health')).body;
    expect(health).toMatchObject({
      db: true,
      armoriqConfigured: true,
      armoriqVerified: { verdict: expect.any(String) },
    });
  });

  it('replays the run over SSE and resumes after Last-Event-ID', async () => {
    const w = world();
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);

    async function read(headers: Record<string, string>, wanted: number) {
      const response = await w.app.request(`/api/runs/${run.id}/events`, { headers });
      const reader = response.body!.getReader();
      let text = '';
      while ((text.match(/^id: /gm) ?? []).length < wanted) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      await reader.cancel();
      return [...text.matchAll(/^id: (\d+)/gm)].map((match) => Number(match[1]));
    }

    const all = w.engine.timeline(run.id).map((event) => event.id);
    expect(await read({}, all.length)).toEqual(all);
    const half = all[Math.floor(all.length / 2)]!;
    expect(
      await read({ 'last-event-id': String(half) }, all.length - all.indexOf(half) - 1),
    ).toEqual(all.slice(all.indexOf(half) + 1));
  });

  it('keeps the app usable but commit closed when ArmorIQ is not configured', async () => {
    const w = world({}, false);
    const api = client(w);
    await api.login();
    const { b } = w.simulated();
    await api.call('POST', `/api/branches/${b.id}/authorize`);

    const commit = await api.call('POST', `/api/branches/${b.id}/commit`);
    expect(commit).toMatchObject({
      status: 503,
      body: {
        code: 'ARMORIQ_NOT_CONFIGURED',
        message: expect.stringMatching(/Nothing can be committed/),
      },
    });
    expect((await api.call('GET', '/api/health')).body.armoriqConfigured).toBe(false);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
  });
});

describe('evidence', () => {
  it('reconciles approved, executed and ledger totals, and exports the same rows it lists', async () => {
    const w = world();
    const api = client(w);
    await api.login();
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await w.engine.tamperTest(b.id, CFO.email);
    await w.engine.settled((await w.engine.commitBranch(b.id, CFO.email)).id);

    const view = (await api.call('GET', `/api/runs/${run.id}`)).body;
    expect(view.reconciliation).toEqual([
      {
        executionId: expect.any(String),
        branchId: b.id,
        authorizedCents: 4_000_000,
        executedCents: 4_000_000,
        ledgerCents: 4_000_000,
      },
    ]);
    expect(view.receipts).toHaveLength(6);

    const blocked = (await api.call('GET', `/api/audit?run=${run.id}&verdict=block`)).body.events;
    expect(blocked).toHaveLength(1);
    expect(blocked[0].payload).toMatchObject({
      tool: 'update_vendor_destination',
      errorClass: 'IntentMismatchException',
    });
    expect((await api.call('GET', `/api/audit?q=CAPABILITY_INVALID`)).body.events).toHaveLength(1);

    const csv = await (
      await w.app.request(`/api/audit?run=${run.id}&verdict=block&format=csv`)
    ).text();
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"update_vendor_destination","block","IntentMismatchException"');
    const json = await (await w.app.request(`/api/audit?run=${run.id}&format=json`)).json();
    expect(JSON.stringify(json)).not.toContain('approvedExecutionRef');

    const replay = (await api.call('GET', `/api/branches/${b.id}/replay`)).body;
    expect(replay).toMatchObject({
      matchesStored: true,
      projection: { cashAfterCents: 1_000_000 },
    });
    expect(cashCents(w.db, SCENARIO)).toBe(1_000_000);
  });

  it('shows a partial commit as a mismatch between approved and executed, not as a clean run', async () => {
    const w = world({ approveHolds: false });
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    await w.engine.settled((await w.engine.commitBranch(b.id, CFO.email)).id);
    expect(w.engine.getRun(run.id).reconciliation[0]).toMatchObject({
      authorizedCents: 4_000_000,
      executedCents: 2_800_000,
      ledgerCents: 2_800_000,
    });
  });
});
