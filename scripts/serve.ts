// one process, one port, for hosting: the payment MCP at /mcp and the engine API at /api.
// they share one database file, which is why they are deployed together.
//   PORT=8080 tsx scripts/serve.ts
import { serve } from '@hono/node-server';
import { openDb, seedScenario } from '@fork/db';
import { buildEngine } from '../apps/engine/src/main';
import { buildMcp } from '../apps/finance-mcp/src/main';

const db = openDb();
seedScenario(db);
const mcp = buildMcp(process.env, db);
const { app: api, engine } = buildEngine(process.env, db, { mcpInProcess: true });

const port = Number(process.env.PORT ?? 8080);
serve(
  {
    port,
    fetch(request: Request) {
      const { pathname } = new URL(request.url);
      return pathname.startsWith('/api/') ? api.fetch(request) : mcp.fetch(request);
    },
  },
  () => console.log(`fork listening on :${port} (engine at /api, MCP at /mcp)`),
);

engine
  .resumeInFlight()
  .catch((error) => console.error('could not resume in-flight commits', error));
