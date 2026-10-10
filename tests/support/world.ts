import { createApp as createMcpApp } from '../../apps/finance-mcp/src/http';
import { registerTools } from '../../apps/finance-mcp/src/tools';
import { createApp } from '../../apps/engine/src/app';
import { createEngine, type Branch } from '../../apps/engine/src/service';
import { fakeGateway, type FakeOptions } from '../../packages/armor-adapter/test/fake-gateway';
import { openDb, seedScenario } from '@fork/db';
import { liquidityShortfall, referenceBranches } from '@fork/domain-finance';

export const SCENARIO = 'liquidity-shortfall';
export const CFO = { email: 'cfo@kettleandpine.test', password: 'correct horse' };
export const ADMIN_KEY = 'test-admin';
const MCP_KEY = 'test-mcp-key';
const SECRET = 'test-capability-secret';

type Policy = Omit<FakeOptions, 'mcp' | 'mcpKey'>;
// the policy the real platform runs: destination changes blocked, large payments held
const DEFAULT_POLICY: Policy = {
  block: ['update_vendor_destination'],
  hold: ['execute_large_payment'],
  approveHolds: true,
};

// a whole FORK in memory: ledger, MCP, engine and API, with a stand-in for ArmorIQ
export function world(policy: Policy = {}, configured = true) {
  const db = openDb(':memory:');
  seedScenario(db);
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
    });

  const gateway = gatewayFor();
  const engine = engineFor(configured ? gateway : null);
  const app = createApp({
    db,
    engine,
    cfo: CFO,
    adminKey: ADMIN_KEY,
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

  return { db, mcp, gateway, engine, app, simulated, gatewayFor, engineFor };
}
