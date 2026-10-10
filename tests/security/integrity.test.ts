import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', '.next', 'dist', 'migrations', '.git']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx|mts|mjs)$/.test(name) ? [path] : [];
  });
}

const files = ['apps', 'packages', 'scripts', 'tests']
  .flatMap((dir) => walk(join(ROOT, dir)))
  .map((path) => ({
    path: relative(ROOT, path).split(sep).join('/'),
    text: readFileSync(path, 'utf8'),
  }));

const isTest = (path: string) =>
  path.startsWith('tests/') || /\.test\.tsx?$/.test(path) || path.includes('/test/');
const product = files.filter((file) => !isTest(file.path));
const offenders = (list: typeof files, pattern: RegExp) =>
  list.filter((file) => pattern.test(file.text)).map((file) => file.path);

describe('eligibility guards', () => {
  it('scans a real codebase', () => {
    expect(product.length).toBeGreaterThan(25);
  });

  it('only armor-adapter imports the ArmorIQ SDK', () => {
    const importers = offenders(
      files,
      /from\s+['"]@armoriq\/sdk['"]|require\(['"]@armoriq\/sdk['"]\)/,
    );
    expect(importers.filter((path) => !path.startsWith('packages/armor-adapter/'))).toEqual([]);
    expect(importers.length).toBeGreaterThan(0);
  });

  it('nothing outside finance-mcp talks to the MCP directly', () => {
    const outside = product.filter((file) => !file.path.startsWith('apps/finance-mcp/'));
    expect(offenders(outside, /@modelcontextprotocol\/sdk/)).toEqual([]);
    expect(offenders(outside, /['"`][^'"`\n]*\/mcp['"`/?]/)).toEqual([]);
    expect(offenders(outside, /tools\/call/)).toEqual([]);
  });

  it('no verdict is assigned outside verdict.ts', () => {
    const assigned = /verdict\s*(:|=(?!=))\s*['"`](allow|hold|block)['"`]/;
    const allowed = 'packages/armor-adapter/src/verdict.ts';
    expect(offenders(product, assigned).filter((path) => path !== allowed)).toEqual([]);
    expect(assigned.test(files.find((file) => file.path === allowed)?.text ?? '')).toBe(true);
  });

  it('the ArmorIQ test double cannot be reached from product code', () => {
    expect(offenders(product, /fake-gateway|armor-adapter\/test/)).toEqual([]);
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages/armor-adapter/package.json'), 'utf8'),
    );
    expect(Object.values(manifest.exports)).toEqual(['./src/index.ts']);
    expect(
      offenders(
        files.filter((file) => file.path.startsWith('packages/armor-adapter/src/')),
        /\.\.\/test\//,
      ),
    ).toEqual([]);
  });

  it('the model-facing code has no way to reach secrets, tokens or ledger writes', () => {
    const agentFiles = product.filter((file) => file.path.startsWith('apps/engine/src/agents/'));
    expect(
      offenders(agentFiles, /process\.env|@fork\/db|capability|ARMORIQ_API_KEY|postEntry/i),
    ).toEqual([]);
  });

  it('the engine never writes ledger tables itself', () => {
    const engine = product.filter((file) => file.path.startsWith('apps/engine/'));
    expect(
      offenders(
        engine,
        /postEntry|insert\((ledgerPostings|receipts|schema\.receipts|schema\.ledgerPostings)\)|update\((invoices|vendors|schema\.vendors|schema\.invoices)\)/,
      ),
    ).toEqual([]);
  });
});
