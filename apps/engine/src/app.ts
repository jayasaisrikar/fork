import { randomUUID } from 'node:crypto';
import type { GatewayHealth } from '@fork/armor-adapter';
import { loadState, schema, type Db } from '@fork/db';
import { AllocationError, liquidityShortfall, referenceBranches } from '@fork/domain-finance';
import { InvalidTransitionError } from '@fork/harness';
import { and, desc, eq, like, lt, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
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
import { ApiError, type AuditEvent, type Engine } from './service';

export interface AppDeps {
  db: Db;
  engine: Engine;
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
    }),
  );

  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof ApiError) {
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

  // anything that changes state needs the CFO's session and its CSRF token
  app.use('/api/*', async (c, next) => {
    const open =
      c.req.method === 'GET' ||
      c.req.path === '/api/auth/login' ||
      c.req.path.startsWith('/api/demo/');
    const session = findSession(db, getCookie(c, SESSION_COOKIE), now());
    if (session) c.set('session', session);
    if (open) return next();
    if (!session) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in as the CFO first');
    if (!csrfMatches(session, c.req.header(CSRF_HEADER)))
      throw new ApiError('BAD_CSRF', 403, 'Missing or wrong CSRF token');
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

  app.get('/api/audit', (c) => {
    const { run, source, type, before } = c.req.query();
    const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
    const filters: SQL[] = [];
    if (run) filters.push(eq(auditEvents.runId, runId(run)));
    if (source) filters.push(eq(auditEvents.source, source as AuditEvent['source']));
    if (type) filters.push(like(auditEvents.type, `${type}%`));
    if (before) filters.push(lt(auditEvents.id, Number(before)));
    const events = db
      .select()
      .from(auditEvents)
      .where(and(...filters))
      .orderBy(desc(auditEvents.id))
      .limit(limit)
      .all();
    return c.json({ events, nextBefore: events.length === limit ? events.at(-1)?.id : null });
  });

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

  return app;
}
