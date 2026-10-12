import { cashCents, schema } from '@fork/db';
import { PROOF_SCENARIO } from '@fork/domain-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../apps/engine/src/app';
import { PROOF_ACTOR } from '../../apps/engine/src/service';
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

  // the raw response, for downloads that are not JSON
  const raw = (path: string) => w.app.request(path, { headers: { cookie } });

  return { call, login, raw, dropCsrf: () => (csrf = '') };
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
    const signedIn = await w.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CFO),
    });
    const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    async function read(headers: Record<string, string>, wanted: number) {
      const response = await w.app.request(`/api/runs/${run.id}/events`, {
        headers: { cookie, ...headers },
      });
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
  it('keeps every route private unless it is on the public list', async () => {
    const w = world();
    const open = new Set([
      'GET /api/health',
      'POST /api/auth/login',
      'GET /api/auth/me',
      'POST /api/proof/run',
    ]);
    const admin = new Set(['POST /api/demo/fixture-branches', 'POST /api/demo/proof-reset']);
    const routes = w.app.routes.filter(
      (route) =>
        route.path.startsWith('/api/') && !route.path.includes('*') && route.method !== 'ALL',
    );
    expect(routes.length).toBeGreaterThan(15);

    for (const { method, path } of routes) {
      const key = `${method} ${path}`;
      const response = await w.app.request(path.replace(/:\w+/g, '1'), {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : '{}',
      });
      const body = (await response.json().catch(() => ({}))) as Json;
      if (open.has(key)) expect(body.code, key).not.toBe('UNAUTHENTICATED');
      else if (admin.has(key)) expect(response.status, key).toBe(403);
      else
        expect({ key, status: response.status, code: body.code }).toEqual({
          key,
          status: 401,
          code: 'UNAUTHENTICATED',
        });
    }
  });

  it('lets a signed-in CFO read without a CSRF token, and still demands one to change anything', async () => {
    const w = world();
    const api = client(w);
    await api.login();
    api.dropCsrf();
    expect((await api.call('GET', '/api/runs')).status).toBe(200);
    expect((await api.call('POST', '/api/runs')).status).toBe(403);
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

    const csv = await (await api.raw(`/api/audit?run=${run.id}&verdict=block&format=csv`)).text();
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"update_vendor_destination","block","IntentMismatchException"');
    const json = await (await api.raw(`/api/audit?run=${run.id}&format=json`)).json();
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
  it('keeps sandbox events out of the CFO audit view', async () => {
    const w = world();
    const api = client(w);
    await api.login();
    const run = w.engine.createRun(PROOF_ACTOR, PROOF_SCENARIO, 'system');
    w.simulated();

    const { body } = await api.call('GET', '/api/audit?limit=500');
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.filter((event: Json) => event.runId === run.id)).toEqual([]);
    expect(body.events.filter((event: Json) => event.actor === PROOF_ACTOR)).toEqual([]);
  });
});

describe('proof mode API', () => {
  it('runs a probe for a visitor who is not signed in', async () => {
    const w = world();
    const { status, body } = await client(w).call('POST', '/api/proof/run', {
      attack: 'policy_blocked_tool',
    });
    expect(status).toBe(200);
    expect(body.steps[1]).toMatchObject({
      armoriq: 'block',
      enforcedBy: 'armoriq_policy',
      errorClass: 'PolicyBlockedException',
      matchedExpectation: true,
    });
    expect(body.ledger.sandbox.postingsAdded).toBe(0);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
  });

  it('takes one of four attacks and nothing else', async () => {
    const api = client(world());
    for (const body of [
      {},
      { attack: 'drain_everything' },
      { attack: 'altered_amount', amountCents: 1 },
      { attack: ['altered_amount'] },
    ]) {
      expect(await api.call('POST', '/api/proof/run', body)).toMatchObject({
        status: 400,
        body: { code: 'BAD_REQUEST' },
      });
    }
    const notJson = await world().app.request('/api/proof/run', { method: 'POST', body: 'x' });
    expect(notJson.status).toBe(400);
  });

  it('refuses a body over 1 KB', async () => {
    const response = await client(world()).call('POST', '/api/proof/run', {
      attack: 'altered_amount',
      padding: 'x'.repeat(2000),
    });
    expect(response).toMatchObject({ status: 413, body: { code: 'BODY_TOO_LARGE' } });
  });

  it('sends Retry-After with a 429', async () => {
    const w = world();
    const app = createApp({
      db: w.db,
      engine: w.engine,
      proof: w.proofFor({ cooldownSeconds: 20 }),
      cfo: CFO,
      adminKey: ADMIN_KEY,
      armorHealth: async () => ({ configured: true, reachable: true, tools: [] }),
    });
    const post = () =>
      app.request('/api/proof/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attack: 'unplanned_tool' }),
      });
    expect((await post()).status).toBe(200);
    const second = await post();
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(second.headers.get('retry-after'))).toBeLessThanOrEqual(20);
    expect((await second.json()).details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('clears an integrity failure only with the admin key', async () => {
    const w = world();
    const api = client(w);
    expect((await api.call('POST', '/api/demo/proof-reset')).status).toBe(403);
    expect(
      await api.call('POST', '/api/demo/proof-reset', undefined, { 'x-admin-key': ADMIN_KEY }),
    ).toMatchObject({ status: 200, body: { cleared: 0 } });
  });

  it('hides the sandbox from a signed-in CFO, who can neither read nor act on it', async () => {
    const w = world();
    const api = client(w);
    await api.login();
    await api.call('POST', '/api/proof/run', { attack: 'unplanned_tool' });
    const run = w.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.scenarioId, PROOF_SCENARIO))
      .get()!;
    const branch = w.db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.runId, run.id))
      .get()!;
    const before = w.engine.timeline(run.id).length;

    const tries: [string, string][] = [
      ['GET', `/api/runs/${run.id}`],
      ['GET', `/api/runs/${run.id}/events`],
      ['POST', `/api/runs/${run.id}/propose`],
      ['POST', `/api/runs/${run.id}/inject`],
      ['GET', `/api/branches/${branch.id}/replay`],
      ['POST', `/api/branches/${branch.id}/simulate`],
      ['POST', `/api/branches/${branch.id}/authorize`],
      ['POST', `/api/branches/${branch.id}/commit`],
      ['POST', `/api/branches/${branch.id}/cancel`],
      ['POST', `/api/branches/${branch.id}/tamper-test`],
      ['POST', `/api/branches/${branch.id}/replan`],
    ];
    for (const [method, path] of tries) {
      const response = await api.call(method, path, method === 'GET' ? undefined : {});
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
    expect(w.engine.timeline(run.id)).toHaveLength(before);
    expect(cashCents(w.db, PROOF_SCENARIO)).toBe(5_000_000);
    expect((await api.call('POST', '/api/proof/run', { attack: 'altered_amount' })).status).toBe(
      200,
    );
  });

  it('answers a HEAD on the health route, for uptime monitors', async () => {
    const response = await world().app.request('/api/health', { method: 'HEAD' });
    expect(response.status).toBe(200);
  });
});
