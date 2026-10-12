import { createApp as createMcpApp } from '../../apps/finance-mcp/src/http';
import { registerTools } from '../../apps/finance-mcp/src/tools';
import { createApp } from '../../apps/engine/src/app';
import { createProof, type ProofDeps } from '../../apps/engine/src/proof';
import { createEngine, type Branch, type EngineDeps } from '../../apps/engine/src/service';
import { fakeGateway, type FakeOptions } from '../../packages/armor-adapter/test/fake-gateway';
import { openDb, seedAll } from '@fork/db';
import { liquidityShortfall, referenceBranches } from '@fork/domain-finance';

export const SCENARIO = 'liquidity-shortfall';
export const CFO = { email: 'cfo@kettleandpine.test', password: 'correct horse' };
export const ADMIN_KEY = 'test-admin';
const MCP_KEY = 'test-mcp-key';
export const SECRET = 'test-capability-secret';

type Policy = Omit<FakeOptions, 'mcp' | 'mcpKey'>;
// the policy the real platform runs: destination changes blocked, large payments held
const DEFAULT_POLICY: Policy = {
  block: ['update_vendor_destination'],
  hold: ['execute_large_payment'],
  approveHolds: true,
};

// a whole FORK in memory: ledger, MCP, engine and API, with a stand-in for ArmorIQ
export function world(
  policy: Policy = {},
  configured = true,
  agents: Pick<EngineDeps, 'planner' | 'inbox' | 'plannerSource'> = {},
  webOrigin?: string,
) {
  const db = openDb(':memory:');
  seedAll(db);
  const mcp = createMcpApp({
    name: 'fork-finance-mcp',
    key: MCP_KEY,
    register: (server) => registerTools(server, { db, capabilitySecret: SECRET }),
  });

  const gatewayFor = (overrides: Policy = {}) =>
    fakeGateway({ mcp, mcpKey: MCP_KEY, ...DEFAULT_POLICY, ...policy, ...overrides });
  const engineFor = (gateway: ReturnType<typeof gatewayFor> | null) =>
    createEngine({
      db,
      gateway,
      capabilitySecret: SECRET,
      gatewayMissingReason: 'ArmorIQ is not configured. Nothing can be committed.',
      planner: agents.planner,
      inbox: agents.inbox,
      plannerSource: agents.plannerSource,
    });

  const gateway = gatewayFor();
  const engine = engineFor(configured ? gateway : null);
  // probes against the same ledger. no cooldown unless a test asks for one.
  const proofFor = (overrides: Partial<ProofDeps> = {}) =>
    createProof({
      db,
      engine,
      gateway: configured ? gateway : null,
      capabilitySecret: SECRET,
      cooldownSeconds: 0,
      ...overrides,
    });

  const app = createApp({
    db,
    engine,
    proof: proofFor(),
    cfo: CFO,
    adminKey: ADMIN_KEY,
    webOrigin,
    armorHealth: async () => ({ configured, reachable: configured, tools: [] }),
  });

  // run -> three fixture branches -> simulated
  function simulated() {
    const run = engine.createRun(CFO.email);
    const fixtures = referenceBranches(liquidityShortfall()).map(
      ({ title, rationale, allocations }) => ({ title, rationale, allocations }),
    );
    const [a, b, c] = engine
      .addBranches(run.id, { branches: fixtures }, 'fixture')
      .map((branch) => engine.simulateBranch(branch.id)) as [Branch, Branch, Branch];
    return { run, a, b, c };
  }

  return { db, mcp, gateway, engine, app, simulated, gatewayFor, engineFor, proofFor };
}
