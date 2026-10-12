import { randomUUID } from 'node:crypto';
import { createGateway } from '@fork/armor-adapter';
import type { Db } from '@fork/db';
import { FINANCE_MCP } from '@fork/shared';
import { handleInbox } from './agents/inbox';
import { createModels } from './agents/models';
import { proposeBranches } from './agents/planner';
import { createApp } from './app';
import { referenceBranches } from '@fork/domain-finance';
import { createProof } from './proof';
import { createEngine, type PlannerRequest } from './service';

type Env = Record<string, string | undefined>;

// builds the engine and its API from environment values. used by the local entry and by the
// single-port deploy entry.
export function buildEngine(env: Env, db: Db, options: { mcpInProcess?: boolean } = {}) {
  const capabilitySecret = env.MCP_CAPABILITY_SECRET;
  if (!capabilitySecret) throw new Error('MCP_CAPABILITY_SECRET is not set, refusing to start');

  // without all three the engine still runs, but commit is off and the UI says why
  const missing = ['ARMORIQ_API_KEY', 'FORK_MCP_KEY', 'CFO_EMAIL'].filter((name) => !env[name]);
  const gateway = missing.length
    ? null
    : createGateway({
        apiKey: env.ARMORIQ_API_KEY!,
        agentId: env.ARMORIQ_AGENT_ID || undefined,
        userId: env.ARMORIQ_USER_ID || undefined,
        mcpName: env.FORK_MCP_NAME ?? FINANCE_MCP,
        mcpKey: env.FORK_MCP_KEY!,
        userEmail: env.CFO_EMAIL!,
        requesterEmail: env.ARMORIQ_REQUESTER_EMAIL || 'fork-agent@kettleandpine.test',
      });
  const gatewayMissingReason = missing.length
    ? `ArmorIQ is not configured (${missing.join(', ')} missing). Nothing can be committed.`
    : undefined;

  // test and demo-rehearsal switch: the planner returns the three reference branches, and every
  // branch it makes is labeled 'fixture'. never set this for a real run.
  const fixturePlanner = env.FORK_FIXTURE_PLANNER === '1';
  const fixtureProposal = async (request: PlannerRequest) => ({
    branches: referenceBranches(request.state)
      .map(({ title, rationale, allocations }) => ({ title, rationale, allocations }))
      .slice(0, request.replan ? 1 : 3),
  });

  // the planner and inbox agent need a model. without one the rest of FORK still works.
  const llmReady =
    env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL_PLANNER && env.LLM_MODEL_INBOX;
  const models = llmReady
    ? createModels({
        baseUrl: env.LLM_BASE_URL!,
        apiKey: env.LLM_API_KEY!,
        plannerModel: env.LLM_MODEL_PLANNER!,
        inboxModel: env.LLM_MODEL_INBOX!,
        sessionId: env.LLM_BASE_URL!.includes('opencode.ai') ? `fork-${randomUUID()}` : undefined,
      })
    : null;

  const engine = createEngine({
    db,
    gateway,
    gatewayMissingReason,
    capabilitySecret,
    planner: fixturePlanner
      ? fixtureProposal
      : models
        ? (request, check) => proposeBranches(models.planner, request, check)
        : undefined,
    plannerSource: fixturePlanner ? 'fixture' : 'agent',
    inbox: models ? (messages, actions) => handleInbox(models.inbox, messages, actions) : undefined,
    // how long a held payment waits for a human on the ArmorIQ platform
    holdTimeoutMs: Number(env.HOLD_TIMEOUT_MS ?? 180_000),
  });

  const proof = createProof({
    db,
    engine,
    gateway,
    gatewayMissingReason,
    capabilitySecret,
    cooldownSeconds: Number(env.PROOF_COOLDOWN_SECONDS ?? 20),
    dailyLimit: Number(env.PROOF_DAILY_LIMIT ?? 200),
  });

  const app = createApp({
    db,
    engine,
    proof,
    cfo: { email: env.CFO_EMAIL ?? '', password: env.CFO_PASSWORD ?? '' },
    adminKey: env.DEMO_ADMIN_KEY,
    webOrigin: env.WEB_ORIGIN,
    secureCookies: env.NODE_ENV === 'production',
    // undefined when the MCP is served from this same process
    mcpHealthUrl: options.mcpInProcess
      ? undefined
      : `http://127.0.0.1:${env.FINANCE_MCP_PORT ?? 8797}/health`,
    armorHealth: async () =>
      gateway
        ? { configured: true, ...(await gateway.health()) }
        : { configured: false, reason: gatewayMissingReason },
  });

  return { app, engine };
}
