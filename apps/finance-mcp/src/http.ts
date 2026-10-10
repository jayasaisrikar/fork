import { createHash, timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';

const KEY_HEADER = 'x-fork-mcp-key';

interface ServeOptions {
  name: string;
  port: number;
  key: string | undefined;
  register: (server: McpServer) => void;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

export function serveMcp({ name, port, key, register }: ServeOptions) {
  if (!key) throw new Error(`${name}: FORK_MCP_KEY is not set, refusing to start`);
  const expected = digest(key);
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: name }));

  app.all('/mcp', async (c) => {
    const given = c.req.header(KEY_HEADER);
    if (!given || !timingSafeEqual(digest(given), expected)) {
      // names only, so we can see what the proxy forwards without leaking values
      const headerNames = [...c.req.raw.headers.keys()].join(', ');
      console.warn(JSON.stringify({ mcp: name, event: 'unauthorized', headerNames }));
      return c.json({ error: 'unauthorized' }, 401);
    }

    // stateless: fresh server per request
    const server = new McpServer({ name, version: '0.1.0' });
    register(server);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return serve({ fetch: app.fetch, port }, () => console.log(`${name} listening on :${port}/mcp`));
}

export function logCall(tool: string, params: unknown) {
  console.log(JSON.stringify({ at: new Date().toISOString(), tool, params }));
}

export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}
