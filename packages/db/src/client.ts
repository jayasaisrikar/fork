import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;
// what a transaction callback gets, and what plain queries accept too
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

// relative paths are taken from the repo root, so the engine and the MCP open the same file
export function openDb(path = process.env.DATABASE_PATH ?? './fork.db'): Db {
  const file = path === ':memory:' || isAbsolute(path) ? path : resolve(REPO_ROOT, path);
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
