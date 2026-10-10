import type { Db } from '@fork/db';
import { FINANCE_MCP } from '@fork/shared';
import { createApp } from './http';
import { registerTools } from './tools';

type Env = Record<string, string | undefined>;

export function buildMcp(env: Env, db: Db) {
  const capabilitySecret = env.MCP_CAPABILITY_SECRET;
  if (!capabilitySecret) throw new Error('MCP_CAPABILITY_SECRET is not set, refusing to start');
  return createApp({
    name: FINANCE_MCP,
    key: env.FORK_MCP_KEY,
    register: (server) => registerTools(server, { db, capabilitySecret }),
  });
}
