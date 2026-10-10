import { createHash, timingSafeEqual } from 'node:crypto';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';

// ours, plus the two the ArmorIQ registry knows how to send
const KEY_HEADERS = ['x-fork-mcp-key', 'x-api-key'];
const RPC_FIELDS = ['jsonrpc', 'id', 'method', 'params', 'result', 'error'];

interface ServeOptions {
  name: string;
  port: number;
  key: string | undefined;
  register: (server: McpServer) => void;
}

const digest = (value: string) => createHash('sha256').update(value).digest();

function keyFrom(headers: Headers): string | undefined {
  for (const name of KEY_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
}

// the ArmorIQ proxy adds _iam_context next to the JSON-RPC fields and the MCP SDK rejects extras
function rpcOnly(message: unknown): unknown {
  if (Array.isArray(message)) return message.map(rpcOnly);
  if (!message || typeof message !== 'object') return message;
  return Object.fromEntries(
    Object.entries(message).filter(([field]) => RPC_FIELDS.includes(field)),
  );
}

export function createApp({ name, key, register }: Omit<ServeOptions, 'port'>) {
  if (!key) throw new Error(`${name}: FORK_MCP_KEY is not set, refusing to start`);
  const expected = digest(key);
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: name }));

  app.all('/mcp', async (c) => {
    const given = keyFrom(c.req.raw.headers);
    if (!given || !timingSafeEqual(digest(given), expected)) {
      // names only, so we can see what the proxy forwards without leaking values
      const headerNames = [...c.req.raw.headers.keys()].join(', ');
      console.warn(
        JSON.stringify({ at: new Date().toISOString(), event: 'unauthorized', headerNames }),
      );
      return c.json({ error: 'unauthorized' }, 401);
    }

    let parsedBody: unknown;
    if (c.req.method === 'POST') {
      try {
        parsedBody = rpcOnly(await c.req.raw.clone().json());
      } catch {
        // not JSON, let the transport answer with its own parse error
      }
    }

    // stateless: fresh server per request
    const server = new McpServer({ name, version: '0.1.0' });
    register(server);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(c.req.raw, { parsedBody });
    // one line per request, so we can see what the platform's probes actually ask for
    const rpc = (parsedBody as { method?: unknown } | undefined)?.method;
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        http: c.req.method,
        rpc,
        status: response.status,
      }),
    );
    return response;
  });

  return app;
}

export function serveMcp(options: ServeOptions) {
  const app = createApp(options);
  return serve({ fetch: app.fetch, port: options.port }, () =>
    console.log(`${options.name} listening on :${options.port}/mcp`),
  );
}
