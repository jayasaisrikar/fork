// wipes the sandbox database. the ledger is append-only, so a reset means a new file.
// stop the engine and the MCP first, then start them again; they re-seed on boot.
import { rmSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const configured = process.env.DATABASE_PATH ?? './fork.db';
const file = isAbsolute(configured) ? configured : resolve(root, configured);

for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
console.log(`removed ${file}. restart the engine and the MCP to re-seed.`);
