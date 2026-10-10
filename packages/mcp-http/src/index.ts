import { createHash, timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';

export const SECRET_HEADER = 'x-fork-secret';

export interface McpHttpOptions {
  name: string;
  port: number;
  /** Shared secret callers must send in X-Fork-Secret. The server refuses to start without one. */
  secret: string | undefined;
  register: (server: McpServer) => void;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Serves an MCP server over stateless Streamable HTTP at /mcp, behind the shared secret. */
export function serveMcp({ name, port, secret, register }: McpHttpOptions) {
  if (!secret) {
    throw new Error(`${name}: FORK_MCP_SECRET is not set. Refusing to start without it.`);
  }
  const expected = digest(secret);
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: name }));

  app.all('/mcp', async (c) => {
    const given = c.req.header(SECRET_HEADER);
    if (!given || !timingSafeEqual(digest(given), expected)) {
      // Header names only, never values: enough to see what the ArmorIQ proxy forwards.
      const headerNames = [...c.req.raw.headers.keys()].join(', ');
      console.warn(JSON.stringify({ mcp: name, event: 'unauthorized', headerNames }));
      return c.json({ error: 'unauthorized' }, 401);
    }
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

/** Logs a tool call as one JSON line. */
export function logCall(mcp: string, tool: string, params: unknown) {
  console.log(JSON.stringify({ at: new Date().toISOString(), mcp, tool, params }));
}

/** Wraps a value as a compact-JSON MCP tool result. */
export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}
