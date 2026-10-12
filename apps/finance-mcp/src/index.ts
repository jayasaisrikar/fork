import { serve } from '@hono/node-server';
import { openDb, seedAll } from '@fork/db';
import { FINANCE_MCP } from '@fork/shared';
import { buildMcp } from './main';

const db = openDb();
seedAll(db);
const app = buildMcp(process.env, db);

const port = Number(process.env.FINANCE_MCP_PORT ?? 8797);
serve({ fetch: app.fetch, port }, () => console.log(`${FINANCE_MCP} listening on :${port}/mcp`));
