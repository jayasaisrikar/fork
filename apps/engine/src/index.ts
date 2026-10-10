import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'fork-engine' }));

const port = Number(process.env.ENGINE_PORT ?? 8790);
serve({ fetch: app.fetch, port }, () => console.log(`fork-engine listening on :${port}`));
