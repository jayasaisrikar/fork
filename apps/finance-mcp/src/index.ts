import { openDb, seedScenario } from '@fork/db';
import { FINANCE_MCP } from '@fork/shared';
import { serveMcp } from './http';
import { registerTools } from './tools';

const capabilitySecret = process.env.MCP_CAPABILITY_SECRET;
if (!capabilitySecret) throw new Error('MCP_CAPABILITY_SECRET is not set, refusing to start');

const db = openDb();
seedScenario(db);

serveMcp({
  name: FINANCE_MCP,
  port: Number(process.env.FINANCE_MCP_PORT ?? 8797),
  key: process.env.FORK_MCP_KEY,
  register: (server) => registerTools(server, { db, capabilitySecret }),
});
