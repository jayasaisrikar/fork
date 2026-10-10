import { serve } from '@hono/node-server';
import { openDb, seedScenario } from '@fork/db';
import { buildEngine } from './main';

const db = openDb();
seedScenario(db);
const { app, engine } = buildEngine(process.env, db);

const port = Number(process.env.ENGINE_PORT ?? 8790);
serve({ fetch: app.fetch, port }, () => console.log(`fork-engine listening on :${port}`));

engine
  .resumeInFlight()
  .catch((error) => console.error('could not resume in-flight commits', error));
