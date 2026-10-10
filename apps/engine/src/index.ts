import { serve } from '@hono/node-server';
import { createGateway } from '@fork/armor-adapter';
import { openDb, seedScenario } from '@fork/db';
import { FINANCE_MCP } from '@fork/shared';
import { handleInbox } from './agents/inbox';
import { createModels } from './agents/models';
import { proposeBranches } from './agents/planner';
import { createApp } from './app';
import { createEngine } from './service';

const env = process.env;
const capabilitySecret = env.MCP_CAPABILITY_SECRET;
if (!capabilitySecret) throw new Error('MCP_CAPABILITY_SECRET is not set, refusing to start');

const db = openDb();
seedScenario(db);

// without all three the engine still runs, but commit is off and the UI says why
const missing = ['ARMORIQ_API_KEY', 'FORK_MCP_KEY', 'CFO_EMAIL'].filter((name) => !env[name]);
const gateway = missing.length
  ? null
  : createGateway({
      apiKey: env.ARMORIQ_API_KEY!,
      agentId: env.ARMORIQ_AGENT_ID || undefined,
      userId: env.ARMORIQ_USER_ID || undefined,
      mcpName: FINANCE_MCP,
      mcpKey: env.FORK_MCP_KEY!,
      userEmail: env.CFO_EMAIL!,
      requesterEmail: env.ARMORIQ_REQUESTER_EMAIL || 'fork-agent@kettleandpine.test',
    });
const gatewayMissingReason = missing.length
  ? `ArmorIQ is not configured (${missing.join(', ')} missing). Nothing can be committed.`
  : undefined;

// the planner and inbox agent need a model. without one the rest of FORK still works.
const llmReady =
  env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL_PLANNER && env.LLM_MODEL_INBOX;
const models = llmReady
  ? createModels({
      baseUrl: env.LLM_BASE_URL!,
      apiKey: env.LLM_API_KEY!,
      plannerModel: env.LLM_MODEL_PLANNER!,
      inboxModel: env.LLM_MODEL_INBOX!,
    })
  : null;

const engine = createEngine({
  db,
  gateway,
  gatewayMissingReason,
  capabilitySecret,
  planner: models ? (request, check) => proposeBranches(models.planner, request, check) : undefined,
  inbox: models ? (messages, actions) => handleInbox(models.inbox, messages, actions) : undefined,
  // how long a held payment waits for a human on the ArmorIQ platform
  holdTimeoutMs: Number(env.HOLD_TIMEOUT_MS ?? 180_000),
});

const app = createApp({
  db,
  engine,
  cfo: { email: env.CFO_EMAIL ?? '', password: env.CFO_PASSWORD ?? '' },
  adminKey: env.DEMO_ADMIN_KEY,
  webOrigin: env.WEB_ORIGIN,
  secureCookies: env.NODE_ENV === 'production',
  mcpHealthUrl: `http://127.0.0.1:${env.FINANCE_MCP_PORT ?? 8797}/health`,
  armorHealth: async () =>
    gateway
      ? { configured: true, ...(await gateway.health()) }
      : { configured: false, reason: gatewayMissingReason },
});

const port = Number(env.ENGINE_PORT ?? 8790);
serve({ fetch: app.fetch, port }, () => console.log(`fork-engine listening on :${port}`));

engine
  .resumeInFlight()
  .catch((error) => console.error('could not resume in-flight commits', error));
