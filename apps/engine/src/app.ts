import { randomUUID } from 'node:crypto';
import type { GatewayHealth } from '@fork/armor-adapter';
import { loadState, schema, type Db } from '@fork/db';
import { AllocationError, liquidityShortfall, referenceBranches } from '@fork/domain-finance';
import { InvalidTransitionError } from '@fork/harness';
import { and, desc, eq, isNull, like, lt, notInArray, or, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  csrfMatches,
  CSRF_HEADER,
  findSession,
  login,
  logout,
  SESSION_COOKIE,
  type CfoAccount,
  type Session,
} from './auth';
import { ATTACKS, type Proof } from './proof';
import { ApiError, type AuditEvent, type Engine } from './service';

export interface AppDeps {
  db: Db;
  engine: Engine;
  proof: Proof;
  cfo: CfoAccount;
  adminKey?: string;
  webOrigin?: string;
  secureCookies?: boolean;
  armorHealth: () => Promise<{ configured: boolean; reason?: string } & Partial<GatewayHealth>>;
  mcpHealthUrl?: string;
  now?: () => Date;
}

type Env = { Variables: { requestId: string; session: Session } };

const { auditEvents, executionSteps } = schema;

export function createApp(deps: AppDeps) {
  const { db, engine } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new Hono<Env>();

  app.use('*', async (c, next) => {
    c.set('requestId', randomUUID());
    await next();
  });
  app.use(
    '/api/*',
    cors({
      origin: deps.webOrigin ?? 'http://localhost:3000',
      credentials: true,
      allowHeaders: ['content-type', CSRF_HEADER],
      exposeHeaders: ['Retry-After'],
    }),
  );

  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof ApiError) {
      const retry = (error.details as { retryAfterSeconds?: number } | undefined)
        ?.retryAfterSeconds;
      if (error.status === 429 && retry) c.header('Retry-After', String(retry));
      return c.json(
        { code: error.code, message: error.message, details: error.details, requestId },
        error.status,
      );
    }
    if (error instanceof InvalidTransitionError) {
      return c.json({ code: 'INVALID_TRANSITION', message: error.message, requestId }, 409);
    }
    if (error instanceof AllocationError) {
      return c.json(
        { code: 'INVALID_PROPOSAL', message: error.message, details: error.reasons, requestId },
        422,
      );
    }
    console.error(error);
    return c.json(
      {
        code: 'INTERNAL',
        message: 'Something went wrong on our side. Nothing was paid.',
        requestId,
      },
      500,
    );
  });

  // public by exact method and path. a route that is not listed here needs the CFO session,
  // so a new one is private until someone decides otherwise.
  const PUBLIC = new Set([
    'GET /api/health',
    // uptime monitors ask with HEAD
    'HEAD /api/health',
    'POST /api/auth/login',
    'GET /api/auth/me',
    'POST /api/proof/run',
  ]);
  // these check the admin key themselves
  const ADMIN = new Set(['POST /api/demo/fixture-branches', 'POST /api/demo/proof-reset']);

  app.use('/api/*', async (c, next) => {
    const session = findSession(db, getCookie(c, SESSION_COOKIE), now());
    if (session) c.set('session', session);
    const route = `${c.req.method} ${c.req.path}`;
    if (PUBLIC.has(route) || ADMIN.has(route)) return next();
    if (!session) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in as the CFO first');
    // reading needs the session. changing anything needs the CSRF token as well.
    if (c.req.method !== 'GET' && !csrfMatches(session, c.req.header(CSRF_HEADER)))
      throw new ApiError('BAD_CSRF', 403, 'Missing or wrong CSRF token');
    return next();
  });

  // the proof sandbox belongs to the probes. to a signed-in person it does not exist, so nobody
  // can read it, approve in it or pay from it through these routes.
  app.use('/api/*', async (c, next) => {
    const run = /^\/api\/runs\/(\d+)(\/|$)/.exec(c.req.path);
    const branch = /^\/api\/branches\/([^/]+)\//.exec(c.req.path);
    if (
      (run && engine.sandboxRunIds().includes(Number(run[1]))) ||
      (branch && engine.isSandboxBranch(branch[1]!))
    )
      throw new ApiError('NOT_FOUND', 404, 'Not found');
    return next();
  });

  const requireAdmin = (key: string | undefined) => {
    if (!deps.adminKey || key !== deps.adminKey)
      throw new ApiError('FORBIDDEN', 403, 'Admin key required');
  };
  const runId = (value: string) => {
    const id = Number(value);
    if (!Number.isInteger(id)) throw new ApiError('NOT_FOUND', 404, `No run ${value}`);
    return id;
  };

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const session = login(db, deps.cfo, body.email, body.password, now());
    if (!session) throw new ApiError('BAD_CREDENTIALS', 401, 'Wrong email or password');
    setCookie(c, SESSION_COOKIE, session.id, {
      httpOnly: true,
      path: '/',
      secure: deps.secureCookies ?? false,
      sameSite: deps.secureCookies ? 'None' : 'Lax',
      expires: new Date(session.expiresAt),
    });
    return c.json({ email: session.email, csrfToken: session.csrfToken });
  });

  app.post('/api/auth/logout', (c) => {
    logout(db, c.get('session').id);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', (c) => {
    const session = c.get('session');
    return session
      ? c.json({ email: session.email, csrfToken: session.csrfToken })
      : c.json({ email: null });
  });

  app.get('/api/scenario', (c) => {
    const state = loadState(db, liquidityShortfall().scenarioId);
    if (!state) throw new ApiError('NOT_FOUND', 404, 'The scenario has not been seeded');
    return c.json({ scenario: state });
  });

  app.post('/api/runs', (c) =>
    c.json(engine.getRun(engine.createRun(c.get('session').email).id), 201),
  );
  app.get('/api/runs', (c) => c.json({ runs: engine.listRuns() }));
  app.get('/api/runs/:id', (c) => c.json(engine.getRun(runId(c.req.param('id')))));

  app.post('/api/runs/:id/propose', async (c) =>
    c.json(
      { branches: await engine.proposeBranches(runId(c.req.param('id')), c.get('session').email) },
      201,
    ),
  );
  app.post('/api/runs/:id/inject', (c) =>
    c.json(
      { message: engine.injectHostileMessage(runId(c.req.param('id')), c.get('session').email) },
      201,
    ),
  );
  app.post('/api/branches/:id/replan', async (c) =>
    c.json({ branches: await engine.replan(c.req.param('id'), c.get('session').email) }, 201),
  );

  app.post('/api/branches/:id/simulate', (c) =>
    c.json({ branch: engine.simulateBranch(c.req.param('id')) }),
  );
  app.post('/api/branches/:id/authorize', (c) => {
    const { branch, approvedPlanHash, steps } = engine.authorizeBranch(
      c.req.param('id'),
      c.get('session').email,
    );
    return c.json({ branch, approvedPlanHash, steps });
  });
  app.post('/api/branches/:id/commit', async (c) =>
    c.json(
      { execution: await engine.commitBranch(c.req.param('id'), c.get('session').email) },
      202,
    ),
  );
  app.post('/api/branches/:id/cancel', (c) =>
    c.json({ branch: engine.cancelBranch(c.req.param('id'), c.get('session').email) }),
  );
  app.post('/api/branches/:id/tamper-test', async (c) =>
    c.json(await engine.tamperTest(c.req.param('id'), c.get('session').email)),
  );

  // persisted events first, then live ones. Last-Event-ID lets a reload pick up where it stopped.
  app.get('/api/runs/:id/events', (c) => {
    const id = runId(c.req.param('id'));
    let lastSent = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      const send = async (event: AuditEvent) => {
        if (event.id <= lastSent) return;
        lastSent = event.id;
        await stream.writeSSE({
          id: String(event.id),
          event: 'audit',
          data: JSON.stringify(event),
        });
      };
      const queue: AuditEvent[] = [];
      const onAudit = (event: AuditEvent) => {
        if (event.runId === id) queue.push(event);
      };
      engine.events.on('audit', onAudit);
      stream.onAbort(() => void engine.events.off('audit', onAudit));

      for (const event of engine.timeline(id, lastSent)) await send(event);
      while (!stream.aborted) {
        while (queue.length) await send(queue.shift()!);
        await stream.sleep(250);
      }
    });
  });

  // filter, page and export the evidence. json and csv downloads carry the same rows as the page.
  app.get('/api/audit', (c) => {
    const { run, source, type, verdict, q, before, format } = c.req.query();
    const exporting = format === 'csv' || format === 'json';
    const limit = exporting ? 5000 : Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
    const filters: SQL[] = [];
    if (run) filters.push(eq(auditEvents.runId, runId(run)));
    if (source) filters.push(eq(auditEvents.source, source as AuditEvent['source']));
    if (type) filters.push(like(auditEvents.type, `${type}%`));
    if (before) filters.push(lt(auditEvents.id, Number(before)));
    // the proof sandbox is not the CFO's business. events with no run stay visible.
    const hidden = engine.sandboxRunIds();
    if (hidden.length)
      filters.push(or(isNull(auditEvents.runId), notInArray(auditEvents.runId, hidden))!);

    const needle = q?.toLowerCase();
    const matches = (event: AuditEvent) =>
      (!verdict || event.payload.verdict === verdict) &&
      (!needle ||
        JSON.stringify([event.type, event.actor, event.refs, event.payload])
          .toLowerCase()
          .includes(needle));
    const events = db
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.id))
      .limit(verdict || needle ? 5000 : limit)
      .all()
      .filter(matches)
      .slice(0, limit);

    if (format === 'json') {
      c.header('content-disposition', 'attachment; filename="fork-audit.json"');
      return c.json({ exportedAt: now().toISOString(), events });
    }
    if (format === 'csv') {
      const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const header = [
        'id',
        'at',
        'source',
        'actor',
        'run',
        'type',
        'tool',
        'verdict',
        'error_class',
        'status',
        'refs',
      ];
      const rows = events.map((event) =>
        [
          event.id,
          event.at,
          event.source,
          event.actor,
          event.runId,
          event.type,
          event.payload.tool,
          event.payload.verdict,
          event.payload.errorClass,
          event.type.startsWith('step.') ? event.type.slice(5) : '',
          JSON.stringify(event.refs),
        ]
          .map(cell)
          .join(','),
      );
      c.header('content-type', 'text/csv; charset=utf-8');
      c.header('content-disposition', 'attachment; filename="fork-audit.csv"');
      return c.body([header.join(','), ...rows].join('\n'));
    }
    return c.json({ events, nextBefore: events.length === limit ? events.at(-1)?.id : null });
  });

  app.get('/api/branches/:id/replay', (c) => c.json(engine.replaySimulation(c.req.param('id'))));

  app.get('/api/health', async (c) => {
    const armor = await deps.armorHealth();
    // no URL means the MCP runs inside this process, as it does in tests
    let mcpReachable = !deps.mcpHealthUrl;
    if (deps.mcpHealthUrl) {
      mcpReachable = await fetch(deps.mcpHealthUrl, { signal: AbortSignal.timeout(3000) })
        .then((response) => response.ok)
        .catch(() => false);
    }
    // the last time ArmorIQ itself gave us a verdict
    const lastVerdict = db
      .select({ at: executionSteps.at, verdict: executionSteps.verdict })
      .from(executionSteps)
      .where(eq(executionSteps.source, 'armoriq'))
      .orderBy(desc(executionSteps.id))
      .get();
    return c.json({
      web: true,
      db: true,
      mcpReachable,
      armoriqConfigured: armor.configured,
      armoriqReachable: armor.reachable ?? false,
      armoriqVerified: lastVerdict ?? null,
      registeredTools: armor.tools ?? [],
      reason: armor.reason ?? armor.detail,
    });
  });

  // sandbox helper for tests and demos before the planner exists. the branches are labeled as fixtures.
  app.post('/api/demo/fixture-branches', async (c) => {
    requireAdmin(c.req.header('x-admin-key'));
    const body = await c.req.json().catch(() => ({}));
    const run = engine.getRun(runId(String(body.runId)));
    const fixtures = referenceBranches(liquidityShortfall()).map(
      ({ title, rationale, allocations }) => ({ title, rationale, allocations }),
    );
    return c.json(
      { branches: engine.addBranches(run.run.id, { branches: fixtures }, 'fixture') },
      201,
    );
  });

  // strict on purpose: the public can pick a preset, never write an argument
  const ProofBody = z.strictObject({ attack: z.enum(ATTACKS) });
  app.post(
    '/api/proof/run',
    bodyLimit({
      maxSize: 1024,
      onError: (c) =>
        c.json(
          {
            code: 'BODY_TOO_LARGE',
            message: 'The request body is too large',
            requestId: c.get('requestId'),
          },
          413,
        ),
    }),
    async (c) => {
      const parsed = ProofBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        throw new ApiError('BAD_REQUEST', 400, `attack must be one of: ${ATTACKS.join(', ')}`);
      return c.json(await deps.proof.run(parsed.data.attack));
    },
  );

  // only after someone has looked into why a probe left a posting behind
  app.post('/api/demo/proof-reset', (c) => {
    requireAdmin(c.req.header('x-admin-key'));
    return c.json({ cleared: deps.proof.reset() });
  });

  return app;
}
