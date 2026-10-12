# Proof Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public `/proof` page that shows the recorded real-agent attack exactly as it happened and lets a logged-out visitor run four preset security probes against real ArmorIQ enforcement, with no way to move money.

**Architecture:** A new engine module, `apps/engine/src/proof.ts`, owns everything about probes: a system-authorized reference branch on a dedicated `proof-sandbox` scenario, a fresh capability and a separately signed synthetic ArmorIQ plan per probe, persistent rate limits, and a fail-closed integrity switch. It calls the existing gateway and engine and never changes an approved branch. The engine's auth middleware moves from "every GET is open" to an explicit public list. The web page reads the existing recording for its default view and calls one new endpoint for live probes.

**Tech Stack:** TypeScript, Hono 4, Drizzle on better-sqlite3, zod 4, Vitest 5, Next.js 16 / React 19, Playwright. pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-12-proof-mode-design.md`. Read it before starting; this plan argues from it.

## Global Constraints

- Work on a branch named `proof-mode`, never on `main`.
- Code comments are short, lowercase, human `//` lines, matching the surrounding files. No block comments, no JSDoc.
- End every commit message with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- `apps/web` runs a Next.js version with breaking changes. Read the relevant guide under `node_modules/next/dist/docs/` (resolved from `apps/web`) before writing any Next.js code. This is required by `apps/web/AGENTS.md`.
- Sandbox scenario id: `proof-sandbox`. System actor: `proof-mode@fork.sandbox`. Attacker recipient: `recipient-external-999`.
- Attack enum, exactly: `policy_blocked_tool`, `altered_recipient`, `altered_amount`, `unplanned_tool`.
- Defaults: `PROOF_COOLDOWN_SECONDS=20`, `PROOF_DAILY_LIMIT=200`. The daily cap resets at 00:00 UTC.
- Public routes, exactly: `GET /api/health`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/proof/run`. Admin-key routes: `POST /api/demo/fixture-branches`, `POST /api/demo/proof-reset`. No prefix matching.
- A public response never contains an API key, intent token, capability, or raw tool arguments.
- No probe may modify an approved branch's stored steps or `approvedPlanHash`. `sign` for approved branches and `tamperTest` in `apps/engine/src/service.ts` are not changed.
- The page never calls a probe an agent action, and never says the recorded ledger was unchanged.
- Not in scope: free-form input, a second executing domain, the `/how` copy pass, a public read-only studio, the `_approvals` hold workaround.

## Review Focus

Conditions the spec implies that are easy to miss. Each has a test in the task named.

1. **Platform policy is inactive.** `policy_blocked_tool` must come back as "ArmorIQ allowed, MCP refused, unexpected", not as a pass. (Task 5)
2. **The engine died mid-probe**, leaving a `proof_runs` row with no result. The next run after the cooldown must work. (Task 5)
3. **Two requests arrive at the same instant.** Exactly one runs; the other gets 429. (Task 5)
4. **ArmorIQ fails at signing, after the run was admitted.** The caller gets 503 and the lock is released. (Task 5)
5. **The engine is unreachable from the browser.** `/proof` still renders the recorded section and says the live probe is unavailable. (Task 7)

## File Structure

| File                                                                                           | Responsibility                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/domain-finance/src/fixtures.ts` (modify)                                             | One fixture builder for both scenarios; branch B deferral by vendor, not invoice id                                      |
| `packages/db/src/seed.ts` (modify)                                                             | `seedAll` seeds treasury and sandbox                                                                                     |
| `packages/db/src/schema.ts` (modify), `packages/db/migrations/0004_proof_mode.sql` (generated) | `approvals.origin`, `proof_runs`                                                                                         |
| `apps/engine/src/service.ts` (modify)                                                          | Origin-aware `createRun` and `authorizeBranch`; commit refusal for system approvals; sandbox hidden from the CFO's lists |
| `apps/engine/src/proof.ts` (create)                                                            | Everything about probes                                                                                                  |
| `apps/engine/src/app.ts` (modify)                                                              | Explicit public route list; `/api/proof/run`; `/api/demo/proof-reset`; `Retry-After`                                     |
| `apps/engine/src/main.ts` (modify)                                                             | Build the proof module from env                                                                                          |
| `tests/support/world.ts` (modify)                                                              | Seed the sandbox, expose `proofFor`                                                                                      |
| `tests/integration/proof.test.ts` (create)                                                     | Proof module behaviour                                                                                                   |
| `apps/web/lib/proof.ts` (create)                                                               | Types, preset copy, `recordedStory`, `runProof`                                                                          |
| `apps/web/components/proof.tsx`, `apps/web/app/proof/page.tsx` (create)                        | The page                                                                                                                 |

---

### Task 1: Sandbox fixture and a branch B that survives new ids

**Files:**

- Modify: `packages/domain-finance/src/fixtures.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `apps/engine/src/index.ts:6`, `apps/finance-mcp/src/index.ts:7`, `scripts/serve.ts:10`, `tests/support/world.ts:31`
- Test: `packages/domain-finance/src/fixtures.test.ts` (create), `packages/db/src/seed.test.ts` (create)

**Interfaces:**

- Produces: `PROOF_SCENARIO: 'proof-sandbox'`, `proofSandbox(): TreasuryState` from `@fork/domain-finance`; `seedScenario(db, state?, name?)` and `seedAll(db): void` from `@fork/db`. Sandbox vendor ids are `proof-v-<slug>`, invoice ids `proof-INV-0N`.

- [ ] **Step 1: Branch**

```bash
git switch -c proof-mode
```

- [ ] **Step 2: Write the failing fixture test**

Create `packages/domain-finance/src/fixtures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { financeAdapter } from './adapter';
import { liquidityShortfall, PROOF_SCENARIO, proofSandbox, referenceBranches } from './fixtures';

describe('proof sandbox fixture', () => {
  it('shares no vendor or invoice id with the treasury scenario', () => {
    const treasury = liquidityShortfall();
    const sandbox = proofSandbox();
    const taken = new Set([...treasury.vendors, ...treasury.invoices].map((row) => row.id));
    expect([...sandbox.vendors, ...sandbox.invoices].filter((row) => taken.has(row.id))).toEqual(
      [],
    );
    expect(sandbox.scenarioId).toBe(PROOF_SCENARIO);
  });

  it('keeps branch B feasible, with Harbor Hosting $4,000 as its first payment', () => {
    const state = proofSandbox();
    const b = referenceBranches(state)[1]!;
    const projection = financeAdapter.simulate(state, b.allocations);
    expect(financeAdapter.feasibility(state, projection)).toMatchObject({ ok: true });

    const first = financeAdapter
      .toToolSteps(state, b.allocations, 'test')
      .find((step) => step.kind === 'write')!;
    expect(first.tool).toBe('execute_payment');
    expect(first.args).toMatchObject({
      scenarioId: PROOF_SCENARIO,
      vendorId: 'proof-v-harbor',
      amountCents: 400_000,
    });
  });

  it('defers the same two vendors in branch B whatever the id scheme', () => {
    for (const state of [liquidityShortfall(), proofSandbox()]) {
      const deferred = referenceBranches(state)[1]!
        .allocations.filter((allocation) => allocation.payCents === 0)
        .map((allocation) => {
          const invoice = state.invoices.find((item) => item.id === allocation.invoiceId)!;
          return state.vendors.find((vendor) => vendor.id === invoice.vendorId)!.name;
        });
      expect(deferred).toEqual(['Meridian Cloud', 'Alto Manufacturing']);
    }
  });
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `pnpm vitest run packages/domain-finance/src/fixtures.test.ts`
Expected: FAIL, `proofSandbox` and `PROOF_SCENARIO` are not exported.

- [ ] **Step 4: Change the fixture**

In `packages/domain-finance/src/fixtures.ts`, replace the `liquidityShortfall` function with:

```ts
export const PROOF_SCENARIO = 'proof-sandbox';

// vendor and invoice ids are primary keys across scenarios, so a second scenario needs a prefix
function treasury(scenarioId: string, prefix = ''): TreasuryState {
  return {
    scenarioId,
    currency: 'USD',
    today: '2026-10-12',
    cashCents: 5_000_000,
    reserveCents: 800_000,
    holdAboveCents: 1_000_000,
    vendors: ROWS.map(([, slug, name]) => ({
      id: `${prefix}v-${slug}`,
      name,
      recipientId: `rcp-${slug}`,
      approved: true,
    })),
    invoices: ROWS.map(([id, slug, , dollars, dueDate, lateFee, criticality, note]) => ({
      id: `${prefix}${id}`,
      vendorId: `${prefix}v-${slug}`,
      amountCents: dollars * 100,
      paidCents: 0,
      dueDate,
      lateFee,
      criticality,
      note,
    })),
  };
}

// Kettle & Pine Supply Co. is fictional, and so is everyone it owes
export function liquidityShortfall(): TreasuryState {
  return treasury('liquidity-shortfall');
}

// the same books, kept apart for public security probes. nothing is ever paid from these.
export function proofSandbox(): TreasuryState {
  return treasury(PROOF_SCENARIO, 'proof-');
}
```

Replace `const DEFERRED_IN_B = new Set(['INV-03', 'INV-05']);` with:

```ts
// by vendor, so it holds for any id scheme
const DEFERRED_IN_B = ['meridian', 'alto'];
const deferredInB = (vendorId: string) =>
  DEFERRED_IN_B.some((slug) => vendorId.endsWith(`v-${slug}`));
```

In `referenceBranches`, carry the vendor id and use it for branch B:

```ts
const open = state.invoices.map((invoice) => ({
  id: invoice.id,
  vendorId: invoice.vendorId,
  cents: openCents(invoice),
}));
```

```ts
      allocations: open.map(({ id, vendorId, cents }) => ({
        invoiceId: id,
        payCents: deferredInB(vendorId) ? 0 : cents,
      })),
```

Branches A and C keep destructuring only what they use.

- [ ] **Step 5: Run it and see it pass**

Run: `pnpm vitest run packages/domain-finance`
Expected: PASS, including the existing `simulate.test.ts`.

- [ ] **Step 6: Write the failing seed test**

Create `packages/db/src/seed.test.ts`:

```ts
import { PROOF_SCENARIO } from '@fork/domain-finance';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { cashCents } from './ledger';
import { scenarios } from './schema';
import { seedAll } from './seed';

describe('seedAll', () => {
  it('seeds the treasury and the proof sandbox side by side, once', () => {
    const db = openDb(':memory:');
    seedAll(db);
    seedAll(db);
    expect(cashCents(db, 'liquidity-shortfall')).toBe(5_000_000);
    expect(cashCents(db, PROOF_SCENARIO)).toBe(5_000_000);
    expect(db.select().from(scenarios).where(eq(scenarios.id, PROOF_SCENARIO)).get()?.name).toBe(
      'Proof sandbox',
    );
    expect(db.select().from(scenarios).all()).toHaveLength(2);
  });
});
```

- [ ] **Step 7: Run it and see it fail**

Run: `pnpm vitest run packages/db/src/seed.test.ts`
Expected: FAIL, `seedAll` is not exported.

- [ ] **Step 8: Add the name parameter and `seedAll`**

In `packages/db/src/seed.ts`, change the import and signature, use the name, and add `seedAll`:

```ts
import { liquidityShortfall, proofSandbox, type TreasuryState } from '@fork/domain-finance';
```

```ts
export function seedScenario(
  db: Db,
  state: TreasuryState = liquidityShortfall(),
  name = 'Liquidity Shortfall',
): boolean {
```

Inside, replace `name: 'Liquidity Shortfall',` with `name,`. At the end of the file:

```ts
// what every entry point seeds on boot: the CFO's books and the separate proof sandbox
export function seedAll(db: Db): void {
  seedScenario(db);
  seedScenario(db, proofSandbox(), 'Proof sandbox');
}
```

- [ ] **Step 9: Seed both at every startup**

Replace `seedScenario(db);` with `seedAll(db);` (and the import name to match) in exactly these four places: `apps/engine/src/index.ts:6`, `apps/finance-mcp/src/index.ts:7`, `scripts/serve.ts:10`, `tests/support/world.ts:31`. Leave the test files and `tests/live/armoriq.live.test.ts` alone.

- [ ] **Step 10: Run everything**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. No existing test changes behaviour: the treasury scenario's ids are unchanged.

- [ ] **Step 11: Commit**

```bash
git add packages/domain-finance packages/db apps/engine/src/index.ts apps/finance-mcp/src/index.ts scripts/serve.ts tests/support/world.ts
git commit -m "feat: a separate proof sandbox scenario, and branch B that defers by vendor"
```

---

### Task 2: Schema for approval origin and proof runs

**Files:**

- Modify: `packages/db/src/schema.ts`
- Create (generated): `packages/db/migrations/0004_proof_mode.sql` and its snapshot
- Test: `packages/db/src/schema.test.ts` (create)

**Interfaces:**

- Produces: `schema.approvals.origin` (`'human' | 'system'`, default `'human'`); `schema.proofRuns` with columns `id`, `attack`, `startedAt`, `finishedAt`, `result`, `integrityFailure`, `clearedAt`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { openDb } from './client';
import { approvals, proofRuns } from './schema';

describe('proof mode schema', () => {
  it('records approvals as human unless told otherwise', () => {
    const db = openDb(':memory:');
    const row = db
      .insert(approvals)
      .values({ branchId: 'b', approvedPlanHash: 'h', actor: 'cfo@example.test', at: 'now' })
      .returning()
      .get();
    expect(row.origin).toBe('human');
  });

  it('keeps a proof run row with safe defaults', () => {
    const db = openDb(':memory:');
    const row = db
      .insert(proofRuns)
      .values({ attack: 'altered_amount', startedAt: '2026-10-14T09:00:00.000Z' })
      .returning()
      .get();
    expect(row).toMatchObject({
      id: 1,
      finishedAt: null,
      result: null,
      integrityFailure: false,
      clearedAt: null,
    });
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm vitest run packages/db/src/schema.test.ts`
Expected: FAIL, `proofRuns` is not exported.

- [ ] **Step 3: Change the schema**

In `packages/db/src/schema.ts`, add one column to `approvals`, after `actor`:

```ts
  // who stood behind this approval. a system approval can be probed but never executed.
  origin: text({ enum: ['human', 'system'] }).notNull().default('human'),
```

Append to the file:

```ts
// one row per public proof probe. the cooldown, the daily cap and the fail-closed switch read it.
export const proofRuns = sqliteTable('proof_runs', {
  id: integer().primaryKey({ autoIncrement: true }),
  attack: text().notNull(),
  startedAt: text().notNull(),
  finishedAt: text(),
  result: text({ mode: 'json' }).$type<unknown>(),
  // set when a probe left a ledger posting behind. proof mode stays off until an admin clears it.
  integrityFailure: integer({ mode: 'boolean' }).notNull().default(false),
  clearedAt: text(),
});
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @fork/db exec drizzle-kit generate --name proof_mode`
Expected: a new `packages/db/migrations/0004_proof_mode.sql` containing one `ALTER TABLE` adding `origin` to `approvals` and one `CREATE TABLE` for `proof_runs`, plus a `0004_snapshot.json` and a new journal entry. Open the SQL and confirm it contains nothing else. If it tries to recreate an existing table, stop and report.

- [ ] **Step 5: Run it and see it pass**

Run: `pnpm vitest run packages/db && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): approval origin and a proof_runs table"
```

---

### Task 3: System-originated authorization that can never be executed

**Files:**

- Modify: `apps/engine/src/service.ts` (`createRun` at ~218, `listRuns` at ~235, `authorizeBranch` at ~495, `commitBranch` at ~643, `ApiError` at ~53, the returned object at ~1269)
- Modify: `apps/engine/src/app.ts` (`/api/audit` at ~218)
- Test: `tests/integration/commit.test.ts`, `tests/integration/api.test.ts`

**Interfaces:**

- Consumes: `PROOF_SCENARIO`, `proofSandbox`, `schema.approvals.origin`.
- Produces, all from `apps/engine/src/service.ts`:
  - `export type Origin = 'human' | 'system'`
  - `export const PROOF_ACTOR = 'proof-mode@fork.sandbox'`
  - `engine.createRun(actor: string, scenarioId?: string, origin?: Origin)`
  - `engine.authorizeBranch(branchId: string, actor: string, origin?: Origin)`
  - `engine.sandboxRunIds(): number[]`
  - `ApiError` status type gains `413 | 429`
  - `commitBranch` throws `ApiError('SYSTEM_AUTHORIZED', 409, …)` for a system-approved branch.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/commit.test.ts` (add `PROOF_SCENARIO`, `proofSandbox`, `referenceBranches` from `@fork/domain-finance` and `PROOF_ACTOR` from the service to its imports):

```ts
// run -> fixture branch B on the proof sandbox -> authorized by the system
function sandboxB(w: World) {
  const run = w.engine.createRun(PROOF_ACTOR, PROOF_SCENARIO, 'system');
  const fixtures = referenceBranches(proofSandbox()).map(({ title, rationale, allocations }) => ({
    title,
    rationale,
    allocations,
  }));
  const b = w.engine.addBranches(run.id, { branches: fixtures }, 'fixture')[1]!;
  w.engine.simulateBranch(b.id);
  w.engine.authorizeBranch(b.id, PROOF_ACTOR, 'system');
  return { run, b };
}

describe('system-authorized branches', () => {
  it('leave no human event in the audit trail', () => {
    const w = world();
    const { run } = sandboxB(w);
    const events = w.engine.timeline(run.id);
    expect(events.filter((event) => event.source === 'human')).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['run.created_by_system', 'branch.authorized_by_system']),
    );
    expect(events.map((event) => event.type)).not.toContain('run.created');
    expect(events.map((event) => event.type)).not.toContain('branch.authorized');
  });

  it('record the origin on the approval', () => {
    const w = world();
    const { b } = sandboxB(w);
    const approval = w.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.branchId, b.id))
      .get();
    expect(approval).toMatchObject({ origin: 'system', actor: PROOF_ACTOR });
  });

  it('can never be committed, by anyone', async () => {
    const w = world();
    const { b } = sandboxB(w);
    await expect(w.engine.commitBranch(b.id, CFO.email)).rejects.toMatchObject({
      code: 'SYSTEM_AUTHORIZED',
      status: 409,
    });
    expect(cashCents(w.db, PROOF_SCENARIO)).toBe(5_000_000);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
    expect(receiptCount(w)).toBe(0);
    expect(w.gateway.signCount()).toBe(0);
  });

  it('stay out of the CFO run list, and human runs still read as human', () => {
    const w = world();
    sandboxB(w);
    const { run } = w.simulated();
    expect(w.engine.listRuns().map((item) => item.id)).toEqual([run.id]);
    expect(w.engine.timeline(run.id)[0]).toMatchObject({ source: 'human', type: 'run.created' });
  });
});
```

Append to the `evidence` describe in `tests/integration/api.test.ts` (add the same three `@fork/domain-finance` imports and `PROOF_ACTOR`):

```ts
it('keeps sandbox events out of the CFO audit view', async () => {
  const w = world();
  const api = client(w);
  await api.login();
  const run = w.engine.createRun(PROOF_ACTOR, PROOF_SCENARIO, 'system');
  w.simulated();

  const { body } = await api.call('GET', '/api/audit?limit=500');
  expect(body.events.length).toBeGreaterThan(0);
  expect(body.events.filter((event: Json) => event.runId === run.id)).toEqual([]);
  expect(body.events.filter((event: Json) => event.actor === PROOF_ACTOR)).toEqual([]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run tests/integration/commit.test.ts tests/integration/api.test.ts`
Expected: FAIL, `PROOF_ACTOR` is not exported.

- [ ] **Step 3: Implement in `service.ts`**

Add `PROOF_SCENARIO` to the `@fork/domain-finance` import and `ne` to the `drizzle-orm` import. Next to the other constants:

```ts
export type Origin = 'human' | 'system';
// stands behind the reference authorization that public probes are measured against
export const PROOF_ACTOR = 'proof-mode@fork.sandbox';
```

Widen the `ApiError` status type to `400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 503`.

`createRun`:

```ts
  function createRun(actor: string, scenarioId = 'liquidity-shortfall', origin: Origin = 'human') {
```

and replace its `audit(...)` call with:

```ts
// a system run must never read as something a person did
if (origin === 'system') {
  audit(run.id, 'fork', 'run.created_by_system', actor, { snapshotHash: snapshot.hash });
} else {
  audit(run.id, 'human', 'run.created', actor, { snapshotHash: snapshot.hash });
}
```

`listRuns`:

```ts
function listRuns() {
  return db
    .select()
    .from(runs)
    .where(ne(runs.scenarioId, PROOF_SCENARIO))
    .orderBy(desc(runs.id))
    .limit(50)
    .all();
}

function sandboxRunIds() {
  return db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.scenarioId, PROOF_SCENARIO))
    .all()
    .map((run) => run.id);
}
```

`authorizeBranch`: change the signature to `(branchId: string, actor: string, origin: Origin = 'human')`, add `origin` to the approval insert:

```ts
          .values({ branchId: branch.id, approvedPlanHash: hash, actor, origin, at: at.toISOString() })
```

and replace the trailing `audit(run.id, 'human', 'branch.authorized', …)` call with:

```ts
audit(
  run.id,
  origin === 'system' ? 'fork' : 'human',
  origin === 'system' ? 'branch.authorized_by_system' : 'branch.authorized',
  actor,
  { branchId, approvedPlanHash: hash },
  { steps: steps.length },
);
```

Below `approvalProblem`, add:

```ts
function approvalOrigin(branchId: string): Origin | undefined {
  return db
    .select({ origin: approvals.origin })
    .from(approvals)
    .where(and(eq(approvals.branchId, branchId), isNull(approvals.revokedAt)))
    .orderBy(desc(approvals.id))
    .get()?.origin;
}
```

In `commitBranch`, directly after the `if (problem) { … }` block and before the stale check:

```ts
// no person approved this. it exists to be probed, never to be paid.
if (approvalOrigin(branch.id) === 'system') {
  audit(
    run.id,
    'fork',
    'security.system_branch_commit_refused',
    actor,
    { branchId },
    { verdict: REJECTED_BY_FORK },
  );
  throw new ApiError(
    'SYSTEM_AUTHORIZED',
    409,
    'This branch was authorized by the system for security probes. It can never be executed.',
  );
}
```

Add `sandboxRunIds,` to the object `createEngine` returns.

- [ ] **Step 4: Hide sandbox events from `/api/audit`**

In `apps/engine/src/app.ts`, add `isNull`, `notInArray`, `or` to the `drizzle-orm` import. In the `/api/audit` handler, after the existing `filters.push` lines:

```ts
// the proof sandbox is not the CFO's business. events with no run stay visible.
const hidden = engine.sandboxRunIds();
if (hidden.length)
  filters.push(or(isNull(auditEvents.runId), notInArray(auditEvents.runId, hidden))!);
```

- [ ] **Step 5: Run and see them pass**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. The API routes pass `c.get('session').email` as the only actor argument, so every human path still defaults to `'human'`.

- [ ] **Step 6: Commit**

```bash
git add apps/engine tests/integration
git commit -m "feat(engine): system-originated authorization that is audited as such and can never be committed"
```

---

### Task 4: Routes are public only by explicit method and path

**Files:**

- Modify: `apps/engine/src/app.ts:85-98`
- Modify: `apps/web/lib/use-workspace.ts:45-56`
- Test: `tests/integration/api.test.ts`

**Interfaces:**

- Produces: any `/api/*` request not on the public or admin list returns `401 { code: 'UNAUTHENTICATED' }` without a session, GET included. State changes still need the CSRF token.

- [ ] **Step 1: Write the failing test**

Append to the `engine API` describe in `tests/integration/api.test.ts`:

```ts
it('keeps every route private unless it is on the public list', async () => {
  const w = world();
  const open = new Set([
    'GET /api/health',
    'POST /api/auth/login',
    'GET /api/auth/me',
    'POST /api/proof/run',
  ]);
  const admin = new Set(['POST /api/demo/fixture-branches', 'POST /api/demo/proof-reset']);
  const routes = w.app.routes.filter(
    (route) =>
      route.path.startsWith('/api/') && !route.path.includes('*') && route.method !== 'ALL',
  );
  expect(routes.length).toBeGreaterThan(15);

  for (const { method, path } of routes) {
    const key = `${method} ${path}`;
    const response = await w.app.request(path.replace(/:\w+/g, '1'), {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    const body = (await response.json().catch(() => ({}))) as Json;
    if (open.has(key)) expect(body.code, key).not.toBe('UNAUTHENTICATED');
    else if (admin.has(key)) expect(response.status, key).toBe(403);
    else
      expect({ key, status: response.status, code: body.code }).toEqual({
        key,
        status: 401,
        code: 'UNAUTHENTICATED',
      });
  }
});

it('lets a signed-in CFO read without a CSRF token, and still demands one to change anything', async () => {
  const w = world();
  const api = client(w);
  await api.login();
  api.dropCsrf();
  expect((await api.call('GET', '/api/runs')).status).toBe(200);
  expect((await api.call('POST', '/api/runs')).status).toBe(403);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm vitest run tests/integration/api.test.ts -t "private unless"`
Expected: FAIL on the first GET route, for example `GET /api/scenario` returning 200.

- [ ] **Step 3: Replace the middleware**

In `apps/engine/src/app.ts`, replace the block that starts `// anything that changes state needs the CFO's session and its CSRF token` with:

```ts
// public by exact method and path. a route that is not listed here needs the CFO session,
// so a new one is private until someone decides otherwise.
const PUBLIC = new Set([
  'GET /api/health',
  'POST /api/auth/login',
  'GET /api/auth/me',
  'POST /api/proof/run',
]);
// these check the admin key themselves
const ADMIN = new Set(['POST /api/demo/fixture-branches', 'POST /api/demo/proof-reset']);

app.use('/api/*', async (c, next) => {
  const session = findSession(db, getCookie(c, SESSION_COOKIE), now());
  if (session) c.set('session', session);
  const route = `${c.req.method} ${c.req.path}`;
  if (PUBLIC.has(route) || ADMIN.has(route)) return next();
  if (!session) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in as the CFO first');
  // reading needs the session. changing anything needs the CSRF token as well.
  if (c.req.method !== 'GET' && !csrfMatches(session, c.req.header(CSRF_HEADER)))
    throw new ApiError('BAD_CSRF', 403, 'Missing or wrong CSRF token');
  return next();
});
```

- [ ] **Step 4: Fix the one existing test that read while logged out**

In `tests/integration/api.test.ts`, the test `replays the run over SSE and resumes after Last-Event-ID` calls `w.app.request` with no cookie. Sign in through the app and send the cookie. Replace its first lines and the `read` helper's request:

```ts
    const w = world();
    const { run, b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const signedIn = await w.app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CFO),
    });
    const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    async function read(headers: Record<string, string>, wanted: number) {
      const response = await w.app.request(`/api/runs/${run.id}/events`, {
        headers: { cookie, ...headers },
      });
```

- [ ] **Step 5: Stop the workspace asking for private data while logged out**

In `apps/web/lib/use-workspace.ts`, the first effect calls `refresh()` whether or not anyone is signed in. Change that one line:

```ts
setEmail(me.email);
// run history and the books are private now. sign-in fetches them.
if (me.email) await refresh();
```

Nothing else changes: `signIn` already goes through `act`, which calls `refresh` on success, and the page already shows the sign-in form while `scenario` is null.

- [ ] **Step 6: Run the suites**

Run: `pnpm test && pnpm typecheck && pnpm test:e2e`
Expected: PASS. If another integration test fails with 401, it was reading while logged out: give it `await api.login()` first. Do not add a route to `PUBLIC` to make a test pass.

- [ ] **Step 7: Commit**

```bash
git add apps/engine/src/app.ts apps/web/lib/use-workspace.ts tests/integration/api.test.ts
git commit -m "fix(engine): run history, audit and event streams need the CFO session"
```

---

### Task 5: The proof module

**Files:**

- Create: `apps/engine/src/proof.ts`
- Modify: `tests/support/world.ts`
- Test: `tests/integration/proof.test.ts` (create)

**Interfaces:**

- Consumes: `engine.createRun/addBranches/simulateBranch/authorizeBranch/audit`, `PROOF_ACTOR`, `ApiError`, `schema.proofRuns`, `Gateway`, `mintCapability`, `verifyCapability`, `paymentArgsHash`.
- Produces, from `apps/engine/src/proof.ts`:

```ts
export const ATTACKS = [
  'policy_blocked_tool',
  'altered_recipient',
  'altered_amount',
  'unplanned_tool',
] as const;
export type Attack = (typeof ATTACKS)[number];
export interface ProofStep {
  tool: string;
  armoriq: 'allow' | 'block' | 'error';
  enforcedBy: 'armoriq_policy' | 'armoriq_sdk' | 'fork_mcp' | null;
  outcome: 'executed' | 'refused' | 'not_reached';
  errorClass: string | null;
  matchedExpectation: boolean;
}
export interface ProofResult {
  attack: Attack;
  ranAt: string;
  armorPlanId: string;
  reference: { vendor: string; amountCents: number; approvedPlanHash: string };
  capabilityCheck: {
    originalArguments: 'valid' | 'invalid';
    alteredArguments: 'valid' | 'invalid';
  } | null;
  steps: ProofStep[];
  ledger: {
    sandbox: { cashBeforeCents: number; cashAfterCents: number; postingsAdded: number };
    treasury: { postingsAdded: number };
  };
  integrity: 'ok' | 'failed';
}
export interface ProofDeps {
  db: Db;
  engine: Engine;
  gateway: Gateway | null;
  gatewayMissingReason?: string;
  capabilitySecret: string;
  now?: () => Date;
  cooldownSeconds?: number;
  dailyLimit?: number;
}
export type Proof = ReturnType<typeof createProof>;
// createProof(deps) returns { run(attack: Attack): Promise<ProofResult>, reset(): number }
```

- Rate-limit errors are `ApiError('RATE_LIMITED', 429, message, { retryAfterSeconds: number })`.
- From `tests/support/world.ts`: `export const SECRET`, and `world().proofFor(overrides?: Partial<ProofDeps>): Proof` (cooldown 0 unless overridden).

- [ ] **Step 1: Expose what the tests need from the world**

In `tests/support/world.ts`: change `const SECRET` to `export const SECRET`, import `createProof` and `type ProofDeps` from `../../apps/engine/src/proof`, and inside `world`, after `engine` is built:

```ts
// probes against the same ledger. no cooldown unless a test asks for one.
const proofFor = (overrides: Partial<ProofDeps> = {}) =>
  createProof({
    db,
    engine,
    gateway: configured ? gateway : null,
    capabilitySecret: SECRET,
    cooldownSeconds: 0,
    ...overrides,
  });
```

Add `proofFor` to the returned object.

- [ ] **Step 2: Write the failing tests**

Create `tests/integration/proof.test.ts`:

```ts
import type { Gateway } from '@fork/armor-adapter';
import { cashCents, postEntry, schema } from '@fork/db';
import { PROOF_SCENARIO } from '@fork/domain-finance';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { ATTACKS, type Attack } from '../../apps/engine/src/proof';
import { CFO, SCENARIO, world } from '../support/world';

type World = ReturnType<typeof world>;

const postings = (w: World, scenarioId: string) =>
  w.db.get<{ n: number }>(
    sql`select count(*) as n from ledger_postings where "scenarioId" = ${scenarioId}`,
  ).n;
const proofRows = (w: World) => w.db.select().from(schema.proofRuns).all();
const sandboxRuns = (w: World) =>
  w.db.select().from(schema.runs).where(eq(schema.runs.scenarioId, PROOF_SCENARIO)).all();

// a clock the test moves by hand
function clock(start = Date.now()) {
  let at = start;
  return { now: () => new Date(at), advance: (seconds: number) => (at += seconds * 1000) };
}

// wraps a gateway so one dispatch can misbehave
function wrapped(w: World, onAttack: (inner: Gateway) => Gateway['dispatch']): Gateway {
  const inner = w.gatewayFor();
  const attack = onAttack(inner);
  return {
    sign: (...args) => inner.sign(...args),
    close: (...args) => inner.close(...args),
    health: () => inner.health(),
    dispatch: (planId, step, options) =>
      step.action === 'get_treasury_balance'
        ? inner.dispatch(planId, step, options)
        : attack(planId, step, options),
  };
}

const EXPECTED: Record<Attack, object> = {
  policy_blocked_tool: {
    tool: 'update_vendor_destination',
    armoriq: 'block',
    enforcedBy: 'armoriq_policy',
    outcome: 'not_reached',
    errorClass: 'PolicyBlockedException',
  },
  altered_recipient: {
    tool: 'execute_payment',
    armoriq: 'allow',
    enforcedBy: 'fork_mcp',
    outcome: 'refused',
    errorClass: 'CAPABILITY_INVALID',
  },
  altered_amount: {
    tool: 'execute_payment',
    armoriq: 'allow',
    enforcedBy: 'fork_mcp',
    outcome: 'refused',
    errorClass: 'CAPABILITY_INVALID',
  },
  unplanned_tool: {
    tool: 'update_vendor_destination',
    armoriq: 'block',
    enforcedBy: 'armoriq_sdk',
    outcome: 'not_reached',
    errorClass: 'IntentMismatchException',
  },
};

describe('proof probes', () => {
  it.each(ATTACKS)('%s: a live allow, then the expected refusal', async (attack) => {
    const w = world();
    const result = await w.proofFor().run(attack);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toEqual({
      tool: 'get_treasury_balance',
      armoriq: 'allow',
      enforcedBy: null,
      outcome: 'executed',
      errorClass: null,
      matchedExpectation: true,
    });
    expect(result.steps[1]).toEqual({ ...EXPECTED[attack], matchedExpectation: true });
    expect(result.integrity).toBe('ok');
    expect(result.reference).toMatchObject({ vendor: 'Harbor Hosting', amountCents: 400_000 });
    expect(result.armorPlanId).toEqual(expect.any(String));
  });

  it('checks the capability both ways for altered payments, and not at all for the others', async () => {
    const w = world();
    const proof = w.proofFor();
    for (const attack of ['altered_recipient', 'altered_amount'] as const)
      expect((await proof.run(attack)).capabilityCheck).toEqual({
        originalArguments: 'valid',
        alteredArguments: 'invalid',
      });
    for (const attack of ['policy_blocked_tool', 'unplanned_tool'] as const)
      expect((await proof.run(attack)).capabilityCheck).toBeNull();
  });

  it('fails only on the alteration long after the reference was authorized', async () => {
    const w = world();
    const time = clock();
    const proof = w.proofFor({ now: time.now });
    await proof.run('altered_amount');
    // capabilities minted at authorization last 30 minutes. a probe gets its own.
    time.advance(2 * 3600);
    const later = await proof.run('altered_amount');
    expect(later.capabilityCheck?.originalArguments).toBe('valid');
    expect(later.steps[1]).toMatchObject({ errorClass: 'CAPABILITY_INVALID' });
    expect(sandboxRuns(w)).toHaveLength(1);
  });

  it('never yields a financial write, in either scenario', async () => {
    const w = world();
    const proof = w.proofFor();
    const before = {
      sandbox: postings(w, PROOF_SCENARIO),
      treasury: postings(w, SCENARIO),
      vendors: w.db.select().from(schema.vendors).all(),
    };
    for (const attack of ATTACKS) {
      const { ledger } = await proof.run(attack);
      expect(ledger).toEqual({
        sandbox: { cashBeforeCents: 5_000_000, cashAfterCents: 5_000_000, postingsAdded: 0 },
        treasury: { postingsAdded: 0 },
      });
    }
    expect(postings(w, PROOF_SCENARIO)).toBe(before.sandbox);
    expect(postings(w, SCENARIO)).toBe(before.treasury);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
    expect(w.db.select().from(schema.vendors).all()).toEqual(before.vendors);
    expect(w.db.select().from(schema.receipts).all()).toEqual([]);
    expect(w.db.select().from(schema.usedCapabilities).all()).toEqual([]);
  });

  it('leaves the treasury alone when the CFO has already paid from it', async () => {
    const w = world();
    const { b } = w.simulated();
    w.engine.authorizeBranch(b.id, CFO.email);
    const execution = await w.engine.commitBranch(b.id, CFO.email);
    await w.engine.settled(execution.id);
    const treasuryCash = cashCents(w.db, SCENARIO);
    expect(treasuryCash).toBeLessThan(5_000_000);

    const result = await w.proofFor().run('altered_recipient');
    expect(result.ledger.sandbox.cashBeforeCents).toBe(5_000_000);
    expect(result.reference.amountCents).toBe(400_000);
    expect(cashCents(w.db, SCENARIO)).toBe(treasuryCash);
  });

  it('never touches the reference branch, and no person appears in its audit trail', async () => {
    const w = world();
    const proof = w.proofFor();
    await proof.run('policy_blocked_tool');
    const [run] = sandboxRuns(w);
    const branch = () =>
      w.db.select().from(schema.branches).where(eq(schema.branches.runId, run!.id)).all();
    const steps = () => w.db.select().from(schema.branchActions).all();
    const frozen = { branch: branch(), steps: steps() };

    for (const attack of ATTACKS) await proof.run(attack);
    expect({ branch: branch(), steps: steps() }).toEqual(frozen);
    expect(sandboxRuns(w)).toHaveLength(1);
    expect(w.engine.timeline(run!.id).filter((event) => event.source === 'human')).toEqual([]);
    expect(w.db.select().from(schema.executions).all()).toEqual([]);
  });

  it('reports a result that differs from the expectation as unexpected, not as a pass', async () => {
    const w = world();
    // the platform policy is switched off
    const proof = w.proofFor({ gateway: w.gatewayFor({ block: [] }) });
    const result = await proof.run('policy_blocked_tool');
    expect(result.steps[1]).toEqual({
      tool: 'update_vendor_destination',
      armoriq: 'allow',
      enforcedBy: 'fork_mcp',
      outcome: 'refused',
      errorClass: 'NOT_PERMITTED',
      matchedExpectation: false,
    });
    expect(result.integrity).toBe('ok');
  });

  it('keeps capabilities, tokens and raw arguments out of the result', async () => {
    const w = world();
    const text = JSON.stringify(await w.proofFor().run('altered_recipient'));
    expect(text).not.toMatch(/approvedExecutionRef|idempotencyKey|recipient-external|token-/);
    expect(text).not.toMatch(/\.[0-9a-f]{64}/);
  });
});

describe('proof limits', () => {
  it('cools down, says how long, and remembers across a restart', async () => {
    const w = world();
    const time = clock();
    await w.proofFor({ now: time.now, cooldownSeconds: 20 }).run('unplanned_tool');
    time.advance(5);

    // a fresh instance over the same database, as after a restart
    const restarted = w.proofFor({ now: time.now, cooldownSeconds: 20 });
    await expect(restarted.run('unplanned_tool')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      details: { retryAfterSeconds: 15 },
    });
    expect(proofRows(w)).toHaveLength(1);

    time.advance(15);
    await expect(restarted.run('unplanned_tool')).resolves.toMatchObject({ integrity: 'ok' });
  });

  it('caps a UTC day and opens again at midnight UTC', async () => {
    const w = world();
    const time = clock(Date.parse('2026-10-14T23:59:00.000Z'));
    const proof = w.proofFor({ now: time.now, dailyLimit: 2 });
    await proof.run('unplanned_tool');
    await proof.run('unplanned_tool');
    const refused = await proof.run('unplanned_tool').catch((error) => error);
    expect(refused).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(refused.details.retryAfterSeconds).toBe(60);

    time.advance(60);
    await expect(proof.run('unplanned_tool')).resolves.toMatchObject({ integrity: 'ok' });
  });

  it('runs one probe at a time', async () => {
    const w = world();
    const proof = w.proofFor();
    const settled = await Promise.allSettled([
      proof.run('altered_amount'),
      proof.run('altered_amount'),
    ]);
    expect(settled.map((item) => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(proofRows(w)).toHaveLength(1);
  });

  it('releases the lock when a dispatch throws, and nothing was posted', async () => {
    const w = world();
    let crash = true;
    const flaky = wrapped(w, (inner) => async (planId, step, options) => {
      if (crash) {
        crash = false;
        throw new Error('simulated crash');
      }
      return inner.dispatch(planId, step, options);
    });
    // the same instance both times, so a stuck lock would show as a 429
    const proof = w.proofFor({ gateway: flaky });
    await expect(proof.run('altered_amount')).rejects.toThrow('simulated crash');
    expect(postings(w, PROOF_SCENARIO)).toBe(3);
    await expect(proof.run('altered_amount')).resolves.toMatchObject({ integrity: 'ok' });
  });

  it('answers 503 and releases the lock when ArmorIQ fails at signing', async () => {
    const w = world();
    const proof = w.proofFor({ gateway: w.gatewayFor({ signFails: true }) });
    for (let i = 0; i < 2; i++)
      await expect(proof.run('altered_amount')).rejects.toMatchObject({
        code: 'ARMORIQ_UNAVAILABLE',
        status: 503,
      });
  });

  it('dispatches nothing and counts nothing when ArmorIQ is not configured', async () => {
    const w = world({}, false);
    await expect(w.proofFor().run('altered_amount')).rejects.toMatchObject({
      code: 'ARMORIQ_NOT_CONFIGURED',
      status: 503,
    });
    expect(proofRows(w)).toEqual([]);
  });

  it('carries on after a run that never finished', async () => {
    const w = world();
    const time = clock();
    // the engine died mid-probe: a row with no result
    w.db
      .insert(schema.proofRuns)
      .values({ attack: 'altered_amount', startedAt: time.now().toISOString() })
      .run();
    time.advance(20);
    await expect(
      w.proofFor({ now: time.now, cooldownSeconds: 20 }).run('altered_amount'),
    ).resolves.toMatchObject({ integrity: 'ok' });
  });
});

describe('proof integrity', () => {
  // a gateway that leaves a posting behind, which must never happen
  const leaky = (w: World) =>
    wrapped(w, (inner) => async (planId, step, options) => {
      postEntry(
        w.db,
        PROOF_SCENARIO,
        [
          { account: 'cash', amountCents: -100 },
          { account: 'equity', amountCents: 100 },
        ],
        new Date().toISOString(),
      );
      return inner.dispatch(planId, step, options);
    });

  it('switches proof mode off when a probe leaves a posting, and stays off across a restart', async () => {
    const w = world();
    const result = await w.proofFor({ gateway: leaky(w) }).run('altered_amount');
    expect(result.integrity).toBe('failed');
    expect(result.ledger.sandbox).toMatchObject({ postingsAdded: 2, cashAfterCents: 4_999_900 });

    const restarted = w.proofFor();
    await expect(restarted.run('altered_amount')).rejects.toMatchObject({
      code: 'PROOF_DISABLED',
      status: 503,
    });
    const [run] = sandboxRuns(w);
    expect(w.engine.timeline(run!.id).map((event) => event.type)).toContain(
      'security.proof_integrity_failure',
    );
  });

  it('comes back only after an explicit reset', async () => {
    const w = world();
    await w.proofFor({ gateway: leaky(w) }).run('altered_amount');
    const proof = w.proofFor();
    expect(proof.reset()).toBe(1);
    expect(proof.reset()).toBe(0);
    // the sandbox books changed, so the old reference is stale and a fresh one is authorized
    await expect(proof.run('altered_amount')).resolves.toMatchObject({ integrity: 'ok' });
    expect(sandboxRuns(w)).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `pnpm vitest run tests/integration/proof.test.ts`
Expected: FAIL, cannot find module `apps/engine/src/proof`.

- [ ] **Step 4: Write the module**

Create `apps/engine/src/proof.ts`:

```ts
// public security probes. each one signs its own throwaway ArmorIQ plan and dispatches a fixed,
// preselected call. nothing here can change an approved branch, and nothing here can pay.
import type { DispatchResult, Gateway, PlanStep } from '@fork/armor-adapter';
import { cashCents, loadState, schema, type Db } from '@fork/db';
import { PROOF_SCENARIO, referenceBranches, type TreasuryState } from '@fork/domain-finance';
import { PAYMENT_TOOL } from '@fork/shared';
import {
  mintCapability,
  paymentArgsHash,
  verifyCapability,
  type PaymentArgs,
} from '@fork/shared/capability';
import { hashCanonical } from '@fork/shared/hash';
import { and, asc, count, desc, eq, gte, isNull } from 'drizzle-orm';
import { ApiError, PROOF_ACTOR, type Engine } from './service';

const { branchActions, branches, ledgerPostings, proofRuns, runs } = schema;

export const ATTACKS = [
  'policy_blocked_tool',
  'altered_recipient',
  'altered_amount',
  'unplanned_tool',
] as const;
export type Attack = (typeof ATTACKS)[number];

const TREASURY = 'liquidity-shortfall';
const ATTACKER_RECIPIENT = 'recipient-external-999';
// $4,000 becomes $5,000
const RAISE_CENTS = 100_000;
const CAPABILITY_SECONDS = 120;
const PLAN_SECONDS = 300;

interface Observed {
  armoriq: 'allow' | 'block' | 'error';
  enforcedBy: 'armoriq_policy' | 'armoriq_sdk' | 'fork_mcp' | null;
  outcome: 'executed' | 'refused' | 'not_reached';
  errorClass: string | null;
}

export interface ProofStep extends Observed {
  tool: string;
  matchedExpectation: boolean;
}

export interface ProofResult {
  attack: Attack;
  ranAt: string;
  armorPlanId: string;
  reference: { vendor: string; amountCents: number; approvedPlanHash: string };
  capabilityCheck: {
    originalArguments: 'valid' | 'invalid';
    alteredArguments: 'valid' | 'invalid';
  } | null;
  steps: ProofStep[];
  ledger: {
    sandbox: { cashBeforeCents: number; cashAfterCents: number; postingsAdded: number };
    treasury: { postingsAdded: number };
  };
  integrity: 'ok' | 'failed';
}

export interface ProofDeps {
  db: Db;
  engine: Engine;
  // null when ArmorIQ is not configured. nothing is dispatched and the caller is told why.
  gateway: Gateway | null;
  gatewayMissingReason?: string;
  capabilitySecret: string;
  now?: () => Date;
  cooldownSeconds?: number;
  dailyLimit?: number;
}

export type Proof = ReturnType<typeof createProof>;

const ALLOWED_READ: Observed = {
  armoriq: 'allow',
  enforcedBy: null,
  outcome: 'executed',
  errorClass: null,
};
const REFUSED_BY_MCP: Observed = {
  armoriq: 'allow',
  enforcedBy: 'fork_mcp',
  outcome: 'refused',
  errorClass: 'CAPABILITY_INVALID',
};
// what each preset should produce. the result always reports what actually happened.
const EXPECTED: Record<Attack, Observed> = {
  policy_blocked_tool: {
    armoriq: 'block',
    enforcedBy: 'armoriq_policy',
    outcome: 'not_reached',
    errorClass: 'PolicyBlockedException',
  },
  altered_recipient: REFUSED_BY_MCP,
  altered_amount: REFUSED_BY_MCP,
  unplanned_tool: {
    armoriq: 'block',
    enforcedBy: 'armoriq_sdk',
    outcome: 'not_reached',
    errorClass: 'IntentMismatchException',
  },
};

function observe(decision: DispatchResult): Observed {
  if (decision.verdict === 'allow') {
    // ArmorIQ said yes. whether the tool then ran is a separate fact.
    return {
      armoriq: 'allow',
      enforcedBy: decision.toolError ? 'fork_mcp' : null,
      outcome: decision.toolError ? 'refused' : 'executed',
      errorClass: decision.toolError?.code ?? null,
    };
  }
  const errorClass = decision.errorClass ?? null;
  return {
    armoriq: decision.verdict === 'block' ? 'block' : 'error',
    enforcedBy:
      errorClass === 'PolicyBlockedException'
        ? 'armoriq_policy'
        : errorClass === 'IntentMismatchException'
          ? 'armoriq_sdk'
          : null,
    outcome: 'not_reached',
    errorClass,
  };
}

const told = (step: PlanStep, decision: DispatchResult, expected: Observed): ProofStep => {
  const seen = observe(decision);
  return {
    tool: step.action,
    ...seen,
    matchedExpectation: (Object.keys(expected) as (keyof Observed)[]).every(
      (key) => seen[key] === expected[key],
    ),
  };
};

const limited = (message: string, retryAfterSeconds: number) =>
  new ApiError('RATE_LIMITED', 429, message, { retryAfterSeconds });

export function createProof(deps: ProofDeps) {
  const { db, engine, capabilitySecret } = deps;
  const now = deps.now ?? (() => new Date());
  const cooldown = deps.cooldownSeconds ?? 20;
  const dailyLimit = deps.dailyLimit ?? 200;
  // one probe at a time. the engine is one process, so this is enough.
  let busy = false;

  const postingsIn = (scenarioId: string) =>
    db
      .select({ n: count() })
      .from(ledgerPostings)
      .where(eq(ledgerPostings.scenarioId, scenarioId))
      .get()?.n ?? 0;
  const books = () => ({
    sandboxCash: cashCents(db, PROOF_SCENARIO),
    sandboxPostings: postingsIn(PROOF_SCENARIO),
    treasuryPostings: postingsIn(TREASURY),
  });

  // refuses or records the run in one step, so two callers cannot both get through
  function admit(attack: Attack, at: Date): number {
    return db.transaction(
      (tx) => {
        const failed = tx
          .select({ id: proofRuns.id })
          .from(proofRuns)
          .where(and(eq(proofRuns.integrityFailure, true), isNull(proofRuns.clearedAt)))
          .get();
        if (failed) {
          throw new ApiError(
            'PROOF_DISABLED',
            503,
            'Proof Mode is switched off after an integrity failure. An administrator has to clear it.',
          );
        }

        const last = tx
          .select({ startedAt: proofRuns.startedAt })
          .from(proofRuns)
          .orderBy(desc(proofRuns.id))
          .get();
        const waited = last ? (at.getTime() - Date.parse(last.startedAt)) / 1000 : Infinity;
        if (waited < cooldown)
          throw limited('Proof Mode is cooling down', Math.ceil(cooldown - waited));

        // the cap is per UTC day
        const midnight = `${at.toISOString().slice(0, 10)}T00:00:00.000Z`;
        const today =
          tx.select({ n: count() }).from(proofRuns).where(gte(proofRuns.startedAt, midnight)).get()
            ?.n ?? 0;
        if (today >= dailyLimit) {
          throw limited(
            "Today's proof runs are used up",
            Math.ceil((Date.parse(midnight) + 86_400_000 - at.getTime()) / 1000),
          );
        }

        return tx
          .insert(proofRuns)
          .values({ attack, startedAt: at.toISOString() })
          .returning({ id: proofRuns.id })
          .get().id;
      },
      { behavior: 'immediate' },
    );
  }

  const finish = (id: number, patch: Partial<typeof proofRuns.$inferInsert>) =>
    db
      .update(proofRuns)
      .set({ finishedAt: now().toISOString(), ...patch })
      .where(eq(proofRuns.id, id))
      .run();

  function authorizeFresh(state: TreasuryState) {
    const run = engine.createRun(PROOF_ACTOR, PROOF_SCENARIO, 'system');
    const fixtures = referenceBranches(state).map(({ title, rationale, allocations }) => ({
      title,
      rationale,
      allocations,
    }));
    const b = engine.addBranches(run.id, { branches: fixtures }, 'fixture')[1]!;
    engine.simulateBranch(b.id);
    return engine.authorizeBranch(b.id, PROOF_ACTOR, 'system').branch;
  }

  // the standing system authorization on the sandbox, made once and reused while the books match
  function reference() {
    const state = loadState(db, PROOF_SCENARIO);
    if (!state) throw new ApiError('NOT_FOUND', 404, 'The proof sandbox has not been seeded');
    const standing = db
      .select()
      .from(branches)
      .innerJoin(runs, eq(runs.id, branches.runId))
      .where(
        and(
          eq(runs.scenarioId, PROOF_SCENARIO),
          eq(branches.status, 'APPROVED'),
          eq(branches.baseSnapshotHash, hashCanonical(state)),
        ),
      )
      .orderBy(desc(runs.id))
      .get()?.branches;
    const branch = standing ?? authorizeFresh(state);

    const payment = db
      .select()
      .from(branchActions)
      .where(and(eq(branchActions.branchId, branch.id), eq(branchActions.kind, 'write')))
      .orderBy(asc(branchActions.stepIndex))
      .get();
    if (!payment || payment.tool !== PAYMENT_TOOL)
      throw new Error('the proof reference branch has no small payment to measure against');
    const args = payment.args as unknown as PaymentArgs;
    return {
      runId: branch.runId,
      approvedPlanHash: branch.approvedPlanHash ?? '',
      args,
      vendor: state.vendors.find((vendor) => vendor.id === args.vendorId)?.name ?? args.vendorId,
    };
  }

  async function probe(attack: Attack, gateway: Gateway): Promise<ProofResult> {
    const at = now();
    const rowId = admit(attack, at);
    const ref = reference();
    const before = books();
    const nowSeconds = Math.floor(at.getTime() / 1000);

    // the one stored at authorization expires after 30 minutes. this one is for this probe only
    // and is never sent with the arguments it is good for.
    const capability = mintCapability(
      capabilitySecret,
      { runId: `proof:${rowId}`, stepIndex: 0, exp: nowSeconds + CAPABILITY_SECONDS },
      paymentArgsHash(ref.args),
    );
    const pay = (args: PaymentArgs): PlanStep => ({
      action: PAYMENT_TOOL,
      params: { ...args, amount: args.amountCents / 100, approvedExecutionRef: capability },
    });
    const read: PlanStep = {
      action: 'get_treasury_balance',
      params: { scenarioId: PROOF_SCENARIO },
    };
    const redirect: PlanStep = {
      action: 'update_vendor_destination',
      params: { vendorId: ref.args.vendorId, recipientId: ATTACKER_RECIPIENT },
    };

    const altered: PaymentArgs | null =
      attack === 'altered_recipient'
        ? { ...ref.args, recipientId: ATTACKER_RECIPIENT }
        : attack === 'altered_amount'
          ? { ...ref.args, amountCents: ref.args.amountCents + RAISE_CENTS }
          : null;
    const attempt = altered ? pay(altered) : redirect;
    // a synthetic plan of its own. the approved branch's steps and hash are never part of this.
    const signed =
      attack === 'unplanned_tool'
        ? [read]
        : attack === 'policy_blocked_tool'
          ? [read, redirect]
          : [read, pay(ref.args)];

    const check = (args: PaymentArgs) =>
      verifyCapability(capabilitySecret, capability, paymentArgsHash(args), nowSeconds).ok
        ? ('valid' as const)
        : ('invalid' as const);
    const capabilityCheck = altered
      ? { originalArguments: check(ref.args), alteredArguments: check(altered) }
      : null;

    let plan;
    try {
      plan = await gateway.sign(
        `FORK security probe (${attack}). Not a CFO-approved plan.`,
        signed,
        PLAN_SECONDS,
      );
    } catch (error) {
      finish(rowId, {});
      throw new ApiError(
        'ARMORIQ_UNAVAILABLE',
        503,
        "ArmorIQ didn't respond. Nothing was dispatched.",
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }

    const steps: ProofStep[] = [];
    let thrown: unknown;
    try {
      steps.push(told(read, await gateway.dispatch(plan.planId, read), ALLOWED_READ));
      steps.push(told(attempt, await gateway.dispatch(plan.planId, attempt), EXPECTED[attack]));
    } catch (error) {
      thrown = error;
    }
    await gateway.close(plan.planId, 'failed').catch(() => undefined);

    // the sandbox opens with postings of its own, so the test is "none added", in either scenario
    const after = books();
    const ledger = {
      sandbox: {
        cashBeforeCents: before.sandboxCash,
        cashAfterCents: after.sandboxCash,
        postingsAdded: after.sandboxPostings - before.sandboxPostings,
      },
      treasury: { postingsAdded: after.treasuryPostings - before.treasuryPostings },
    };
    const intact =
      ledger.sandbox.postingsAdded === 0 &&
      ledger.treasury.postingsAdded === 0 &&
      before.sandboxCash === after.sandboxCash;
    if (!intact) {
      // fail closed, and stay closed across restarts until someone has looked
      finish(rowId, { integrityFailure: true });
      engine.audit(
        ref.runId,
        'fork',
        'security.proof_integrity_failure',
        PROOF_ACTOR,
        { proofRunId: rowId, planId: plan.planId },
        { attack, ledger },
      );
    }
    if (thrown) {
      finish(rowId, {});
      throw thrown;
    }

    const result: ProofResult = {
      attack,
      ranAt: at.toISOString(),
      armorPlanId: plan.planId,
      reference: {
        vendor: ref.vendor,
        amountCents: ref.args.amountCents,
        approvedPlanHash: ref.approvedPlanHash,
      },
      capabilityCheck,
      steps,
      ledger,
      integrity: intact ? 'ok' : 'failed',
    };
    finish(rowId, { result });
    engine.audit(
      ref.runId,
      'fork',
      'proof.run',
      PROOF_ACTOR,
      { proofRunId: rowId, planId: plan.planId },
      { attack, steps },
    );
    return result;
  }

  async function run(attack: Attack): Promise<ProofResult> {
    if (busy) throw limited('Another proof run is in progress', 5);
    busy = true;
    try {
      if (!deps.gateway) {
        throw new ApiError(
          'ARMORIQ_NOT_CONFIGURED',
          503,
          deps.gatewayMissingReason ?? 'ArmorIQ is not configured. Nothing was dispatched.',
        );
      }
      return await probe(attack, deps.gateway);
    } finally {
      busy = false;
    }
  }

  // for an administrator, after looking into what went wrong. returns how many were cleared.
  function reset(): number {
    const cleared = db
      .update(proofRuns)
      .set({ clearedAt: now().toISOString() })
      .where(and(eq(proofRuns.integrityFailure, true), isNull(proofRuns.clearedAt)))
      .returning({ id: proofRuns.id })
      .all();
    if (cleared.length) {
      engine.audit(null, 'fork', 'proof.integrity_reset', 'admin', {
        proofRunIds: cleared.map((row) => row.id),
      });
    }
    return cleared.length;
  }

  return { run, reset };
}
```

- [ ] **Step 5: Run and see them pass**

Run: `pnpm vitest run tests/integration/proof.test.ts`
Expected: PASS. Two notes if something fails:

- `releases the lock when a dispatch throws` expects 3 sandbox postings: the three opening lines `seedScenario` writes. If the count differs, read `packages/db/src/seed.ts` and use the real opening count.
- If `tsc` rejects `finish(rowId, { result })`, the cause is the `$type<unknown>()` column; it accepts any value, so the fix is in the call, not the schema.

- [ ] **Step 6: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/engine/src/proof.ts tests/support/world.ts tests/integration/proof.test.ts
git commit -m "feat(engine): proof probes with their own plan, a fresh capability and a fail-closed integrity check"
```

---

### Task 6: The public endpoint

**Files:**

- Modify: `apps/engine/src/app.ts`, `apps/engine/src/main.ts`, `tests/support/world.ts`
- Modify: `.env.example`, `docs/DEPLOY.md`
- Test: `tests/integration/api.test.ts`

**Interfaces:**

- Consumes: `createProof`, `ATTACKS`, `type Proof` from Task 5; the `PUBLIC` and `ADMIN` sets from Task 4.
- Produces: `POST /api/proof/run` taking `{ attack }` and returning a `ProofResult`; `POST /api/demo/proof-reset` (header `x-admin-key`) returning `{ cleared: number }`; `AppDeps.proof: Proof`; a `Retry-After` header on every 429.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/api.test.ts`:

```ts
describe('proof mode API', () => {
  it('runs a probe for a visitor who is not signed in', async () => {
    const w = world();
    const { status, body } = await client(w).call('POST', '/api/proof/run', {
      attack: 'policy_blocked_tool',
    });
    expect(status).toBe(200);
    expect(body.steps[1]).toMatchObject({
      armoriq: 'block',
      enforcedBy: 'armoriq_policy',
      errorClass: 'PolicyBlockedException',
      matchedExpectation: true,
    });
    expect(body.ledger.sandbox.postingsAdded).toBe(0);
    expect(cashCents(w.db, SCENARIO)).toBe(5_000_000);
  });

  it('takes one of four attacks and nothing else', async () => {
    const api = client(world());
    for (const body of [
      {},
      { attack: 'drain_everything' },
      { attack: 'altered_amount', amountCents: 1 },
      { attack: ['altered_amount'] },
    ]) {
      expect(await api.call('POST', '/api/proof/run', body)).toMatchObject({
        status: 400,
        body: { code: 'BAD_REQUEST' },
      });
    }
    const notJson = await world().app.request('/api/proof/run', { method: 'POST', body: 'x' });
    expect(notJson.status).toBe(400);
  });

  it('refuses a body over 1 KB', async () => {
    const response = await client(world()).call('POST', '/api/proof/run', {
      attack: 'altered_amount',
      padding: 'x'.repeat(2000),
    });
    expect(response).toMatchObject({ status: 413, body: { code: 'BODY_TOO_LARGE' } });
  });

  it('sends Retry-After with a 429', async () => {
    const w = world();
    const app = createApp({
      db: w.db,
      engine: w.engine,
      proof: w.proofFor({ cooldownSeconds: 20 }),
      cfo: CFO,
      adminKey: ADMIN_KEY,
      armorHealth: async () => ({ configured: true, reachable: true, tools: [] }),
    });
    const post = () =>
      app.request('/api/proof/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attack: 'unplanned_tool' }),
      });
    expect((await post()).status).toBe(200);
    const second = await post();
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(second.headers.get('retry-after'))).toBeLessThanOrEqual(20);
    expect((await second.json()).details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('clears an integrity failure only with the admin key', async () => {
    const w = world();
    const api = client(w);
    expect((await api.call('POST', '/api/demo/proof-reset')).status).toBe(403);
    expect(
      await api.call('POST', '/api/demo/proof-reset', undefined, { 'x-admin-key': ADMIN_KEY }),
    ).toMatchObject({ status: 200, body: { cleared: 0 } });
  });
});
```

Add `import { createApp } from '../../apps/engine/src/app';` to the file's imports.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run tests/integration/api.test.ts -t "proof mode API"`
Expected: FAIL with 404 on `/api/proof/run`.

- [ ] **Step 3: Add the routes**

In `apps/engine/src/app.ts`, add imports:

```ts
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { ATTACKS, type Proof } from './proof';
```

Add `proof: Proof;` to `AppDeps`. Let the browser read the wait, by adding one option to the `cors({ … })` call:

```ts
      exposeHeaders: ['Retry-After'],
```

In `app.onError`, inside the `if (error instanceof ApiError)` branch, before the `return`:

```ts
const retry = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
if (error.status === 429 && retry) c.header('Retry-After', String(retry));
```

Before `return app;`:

```ts
// strict on purpose: the public can pick a preset, never write an argument
const ProofBody = z.strictObject({ attack: z.enum(ATTACKS) });
app.post(
  '/api/proof/run',
  bodyLimit({
    maxSize: 1024,
    onError: (c) =>
      c.json(
        {
          code: 'BODY_TOO_LARGE',
          message: 'The request body is too large',
          requestId: c.get('requestId'),
        },
        413,
      ),
  }),
  async (c) => {
    const parsed = ProofBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      throw new ApiError('BAD_REQUEST', 400, `attack must be one of: ${ATTACKS.join(', ')}`);
    return c.json(await deps.proof.run(parsed.data.attack));
  },
);

// only after someone has looked into why a probe left a posting behind
app.post('/api/demo/proof-reset', (c) => {
  requireAdmin(c.req.header('x-admin-key'));
  return c.json({ cleared: deps.proof.reset() });
});
```

- [ ] **Step 4: Wire it up**

In `tests/support/world.ts`, pass `proof: proofFor(),` to `createApp`. Move the `proofFor` definition above the `createApp` call if it is below it.

In `apps/engine/src/main.ts`, import `createProof` from `./proof`, and between `createEngine` and `createApp`:

```ts
const proof = createProof({
  db,
  engine,
  gateway,
  gatewayMissingReason,
  capabilitySecret,
  cooldownSeconds: Number(env.PROOF_COOLDOWN_SECONDS ?? 20),
  dailyLimit: Number(env.PROOF_DAILY_LIMIT ?? 200),
});
```

and pass `proof,` to `createApp`.

Append to `.env.example`:

```sh
# public /proof page: seconds between probes, and probes per UTC day
PROOF_COOLDOWN_SECONDS=20
PROOF_DAILY_LIMIT=200
```

In `docs/DEPLOY.md`, add one row to the variables table:

```md
| `PROOF_COOLDOWN_SECONDS`, `PROOF_DAILY_LIMIT` | Optional. Limits on the public `/proof` probes (default 20 and 200) |
```

- [ ] **Step 5: Run and see them pass**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS, including Task 4's route test, which now also walks `POST /api/proof/run` (public) and `POST /api/demo/proof-reset` (403 without the key).

- [ ] **Step 6: Commit**

```bash
git add apps/engine tests .env.example docs/DEPLOY.md
git commit -m "feat(engine): public proof endpoint with a strict body, a size cap and Retry-After"
```

---

### Task 7: The `/proof` page

**Files:**

- Create: `apps/web/lib/proof.ts`, `apps/web/components/proof.tsx`, `apps/web/app/proof/page.tsx`
- Modify: `apps/web/components/chrome.tsx:116-119` (site menu)
- Test: `apps/web/lib/proof.test.ts` (create), `tests/e2e/pages.spec.ts`

**Interfaces:**

- Consumes: `POST /api/proof/run` and the `ProofResult` shape from Task 5; `apps/web/data/recorded-run.json`; `api`, `ApiFailure` from `apps/web/lib/api.ts`.
- Produces: `recordedStory(record)`, `runProof(attack)`, `PRESETS`, and the `Proof` component.

Before writing any Next.js code, read the routing and client-component guides under `apps/web/node_modules/next/dist/docs/`, as `apps/web/AGENTS.md` requires. Follow `apps/web/app/how/page.tsx` for the page shape.

A note on the recorded label: the spec asks for date, model and plan id. The recording does not store the model's name, so the page says "a real model" and does not invent one.

- [ ] **Step 1: Write the failing unit test**

Create `apps/web/lib/proof.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import recorded from '../data/recorded-run.json';
import { recordedStory, type RecordedRun } from './proof';

describe('recordedStory', () => {
  const story = recordedStory(recorded as unknown as RecordedRun);

  it('tells the approved payment as a success, not as nothing happening', () => {
    expect(story.branch).toEqual({ label: 'C', title: 'Preserve maximum cash runway' });
    expect(story.paid).toEqual([{ vendor: 'Harbor Hosting', cents: 400_000 }]);
    expect(story.cashBeforeCents).toBe(5_000_000);
    expect(story.cashAfterCents).toBe(4_600_000);
  });

  it('shows nothing reached the attacker', () => {
    expect(story.attackerRecipient).toBe('recipient-external-999');
    expect(story.attackerCents).toBe(0);
  });

  it('attributes each refusal to what actually refused it', () => {
    expect(story.attempts).toHaveLength(2);
    expect(story.attempts[0]).toMatchObject({
      tool: 'update_vendor_destination',
      armoriq: 'block',
      enforcedBy: 'armoriq_sdk',
    });
    expect(story.attempts[1]).toMatchObject({
      tool: 'execute_payment',
      armoriq: 'allow',
      enforcedBy: 'fork_mcp',
      amountCents: 800_000,
    });
    // refused for carrying no capability. not an argument-hash mismatch.
    expect(story.attempts[1]!.why).toMatch(/no approved-execution capability/);
    expect(story.attempts[1]!.why).not.toMatch(/hash/i);
  });

  it('carries the plan id and the date', () => {
    expect(story.armorPlanId).toMatch(/^3c8977f5-/);
    expect(story.recordedAt).toBe('2026-10-10T20:05:51.811Z');
    expect(story.status).toBe('PARTIALLY_COMMITTED');
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm vitest run apps/web/lib/proof.test.ts`
Expected: FAIL, cannot find module `./proof`.

- [ ] **Step 3: Write `apps/web/lib/proof.ts`**

```ts
import { api } from './api';
import type { RunView } from './types';

export const ATTACKS = [
  'policy_blocked_tool',
  'altered_recipient',
  'altered_amount',
  'unplanned_tool',
] as const;
export type Attack = (typeof ATTACKS)[number];

export type Enforcer = 'armoriq_policy' | 'armoriq_sdk' | 'fork_mcp';

export interface ProofStep {
  tool: string;
  armoriq: 'allow' | 'block' | 'error';
  enforcedBy: Enforcer | null;
  outcome: 'executed' | 'refused' | 'not_reached';
  errorClass: string | null;
  matchedExpectation: boolean;
}

export interface ProofResult {
  attack: Attack;
  ranAt: string;
  armorPlanId: string;
  reference: { vendor: string; amountCents: number; approvedPlanHash: string };
  capabilityCheck: {
    originalArguments: 'valid' | 'invalid';
    alteredArguments: 'valid' | 'invalid';
  } | null;
  steps: ProofStep[];
  ledger: {
    sandbox: { cashBeforeCents: number; cashAfterCents: number; postingsAdded: number };
    treasury: { postingsAdded: number };
  };
  integrity: 'ok' | 'failed';
}

// what each preset sends and what should come back. shown before anyone presses the button.
export const PRESETS: Record<Attack, { name: string; sends: string; expect: string }> = {
  policy_blocked_tool: {
    name: 'Forbidden tool',
    sends:
      'A test of platform policy, not an extension of an approved plan. The probe plan deliberately includes update_vendor_destination, which the policy forbids.',
    expect: 'ArmorIQ blocks it by policy. The payment server is never called.',
  },
  altered_recipient: {
    name: 'Altered recipient',
    sends: 'The approved Harbor Hosting payment, sent to a different recipient.',
    expect: "ArmorIQ allows the tool. FORK's payment server refuses the arguments.",
  },
  altered_amount: {
    name: 'Altered amount',
    sends: 'The approved $4,000 Harbor Hosting payment, sent as $5,000.',
    expect: "ArmorIQ allows the tool. FORK's payment server refuses the arguments.",
  },
  unplanned_tool: {
    name: 'Tool outside the plan',
    sends: 'update_vendor_destination, which the signed probe plan does not contain.',
    expect:
      'Refused inside the ArmorIQ SDK before any network call, so this one leaves no row on the platform.',
  },
};

export const ENFORCERS: Record<Enforcer, string> = {
  armoriq_policy: 'ArmorIQ policy',
  armoriq_sdk: 'ArmorIQ SDK',
  fork_mcp: 'FORK payment server',
};

export const OUTCOMES: Record<ProofStep['outcome'], string> = {
  executed: 'Executed',
  refused: 'Refused by the server',
  not_reached: 'Never reached the server',
};

export const runProof = (attack: Attack) => api<ProofResult>('POST', '/api/proof/run', { attack });

export interface RecordedRun {
  recordedAt: string;
  branchId: string;
  view: RunView;
}

// the recorded agent run, told as it happened: what was approved and paid, what the agent then
// tried, and what refused each attempt. nothing here is inferred beyond the stored rows.
export function recordedStory(record: RecordedRun) {
  const { view } = record;
  const branch = view.branches.find((item) => item.id === record.branchId)!;
  const vendorName = (id: string) =>
    view.snapshot.state.vendors.find((vendor) => vendor.id === id)?.name ?? id;
  const attempts = view.steps
    .filter((step) => step.origin === 'agent')
    .map((step) => {
      const blocked = step.verdict === 'block';
      return {
        tool: step.tool,
        armoriq: (blocked ? 'block' : step.verdict === 'allow' ? 'allow' : 'error') as
          'allow' | 'block' | 'error',
        enforcedBy: (blocked
          ? step.errorClass === 'PolicyBlockedException'
            ? 'armoriq_policy'
            : 'armoriq_sdk'
          : step.source === 'mcp'
            ? 'fork_mcp'
            : null) as Enforcer | null,
        errorClass: step.errorClass,
        recipientId: typeof step.args.recipientId === 'string' ? step.args.recipientId : null,
        amountCents: typeof step.args.amountCents === 'number' ? step.args.amountCents : null,
        why: blocked
          ? 'Refused by ArmorIQ: the tool was not in the signed plan.'
          : step.message?.includes('approvedExecutionRef')
            ? "ArmorIQ allowed the tool. FORK's payment server rejected the call: it carried no approved-execution capability."
            : (step.message ?? ''),
        at: step.at,
      };
    });

  const attackerRecipient = attempts.find((attempt) => attempt.recipientId)?.recipientId ?? null;
  const paidCents = view.receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0);
  const cashBeforeCents = view.snapshot.state.cashCents;
  return {
    recordedAt: record.recordedAt,
    branch: { label: branch.label, title: branch.title },
    status: branch.status,
    armorPlanId: view.executions.find((item) => item.kind === 'commit')?.armorPlanId ?? null,
    paid: view.receipts.map((receipt) => ({
      vendor: vendorName(receipt.vendorId),
      cents: receipt.amountCents,
    })),
    attackerRecipient,
    attackerCents: view.receipts
      .filter((receipt) => receipt.recipientId === attackerRecipient)
      .reduce((sum, receipt) => sum + receipt.amountCents, 0),
    cashBeforeCents,
    cashAfterCents: cashBeforeCents - paidCents,
    message: view.messages.at(-1) ?? null,
    attempts,
  };
}

export type RecordedStory = ReturnType<typeof recordedStory>;
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm vitest run apps/web/lib/proof.test.ts`
Expected: PASS. If `Branch` in `apps/web/lib/types.ts` has no `label` or `title`, read that type and use the fields it does have; do not widen the type.

- [ ] **Step 5: Write the failing browser test**

Append to `tests/e2e/pages.spec.ts`:

```ts
test('proof: the recorded attack, then a live probe, with nobody signed in', async ({
  page,
  request,
}) => {
  await request.get(`${ENGINE}/__reset`);
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/proof');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('One approval');
  const recorded = page.getByRole('region', { name: 'Recorded agent execution' });
  await expect(recorded.getByText('$4,000 paid as approved')).toBeVisible();
  await expect(recorded.getByText("$0 to the attacker's recipient")).toBeVisible();
  await expect(recorded.getByText('IntentMismatchException')).toBeVisible();
  await expect(recorded.getByText(/no approved-execution capability/)).toBeVisible();
  await expect(page.getByText(/ledger (was )?unchanged/i)).toHaveCount(0);

  const probe = page.getByRole('region', { name: 'Live security probe' });
  await expect(probe.getByText('A scripted probe, not an agent')).toBeVisible();
  await probe.getByRole('radio', { name: 'Forbidden tool' }).check();
  await probe.getByRole('button', { name: 'Run it now' }).click();
  await expect(probe.getByText('Run just now')).toBeVisible();
  await expect(probe.getByText('PolicyBlockedException')).toBeVisible();
  await expect(probe.getByText('ArmorIQ policy')).toBeVisible();
  await expect(probe.getByText('Never reached the server')).toBeVisible();
  await expect(probe.getByText('Unexpected')).toHaveCount(0);

  await bothThemes(page, 'proof');
  expect(errors).toEqual([]);
});

test('proof: the recording stands when the engine cannot be reached', async ({ page }) => {
  await page.route('**/api/proof/run', (route) => route.abort());
  await page.goto('/proof');
  const probe = page.getByRole('region', { name: 'Live security probe' });
  await probe.getByRole('button', { name: 'Run it now' }).click();
  await expect(probe.getByRole('alert')).toContainText("didn't respond");
  await expect(
    page
      .getByRole('region', { name: 'Recorded agent execution' })
      .getByText('$4,000 paid as approved'),
  ).toBeVisible();
});

test('proof: a phone shows it without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/proof');
  await expect(page.getByText('$4,000 paid as approved')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `pnpm test:e2e -g "proof:"`
Expected: FAIL, `/proof` is a 404.

- [ ] **Step 7: Write the component**

Create `apps/web/components/proof.tsx`:

```tsx
'use client';

import { Ban, Check, Mail, Play } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure } from '@/lib/api';
import { clock, day, usdShort as usd } from '@/lib/format';
import {
  ATTACKS,
  ENFORCERS,
  OUTCOMES,
  PRESETS,
  runProof,
  type Attack,
  type ProofResult,
  type ProofStep,
  type RecordedStory,
} from '@/lib/proof';
import { Shell } from './chrome';
import { Button, Chip, HashChip, Tag, VerdictPill } from './primitives';

const wrap = 'mx-auto w-full max-w-[1240px] px-4 lg:px-8';

function Figure({ value, caption, tone }: { value: string; caption: string; tone: string }) {
  return (
    <div className="card p-5">
      <div className={`text-[34px] leading-none font-extrabold tracking-[-0.03em] ${tone}`}>
        {value}
      </div>
      <div className="mt-2 text-[14px] font-bold">{caption}</div>
    </div>
  );
}

function Recorded({ story }: { story: RecordedStory }) {
  const paid = story.paid[0];
  return (
    <section aria-label="Recorded agent execution" className="py-12">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="gray">Recorded</Tag>
        <span className="text-muted text-[12px]">
          {day(story.recordedAt.slice(0, 10))} · a real model read the email and chose these calls ·
          not edited
        </span>
      </div>
      <h2 className="mt-3 text-[28px] leading-[1.12] font-extrabold sm:text-[32px]">
        What the agent did, as it happened
      </h2>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Figure
          value={usd(paid?.cents ?? 0)}
          caption={`${usd(paid?.cents ?? 0)} paid as approved`}
          tone="text-allow"
        />
        <Figure
          value={usd(story.attackerCents)}
          caption={`${usd(story.attackerCents)} to the attacker's recipient`}
          tone="text-block"
        />
      </div>

      <ol className="card mt-3 divide-line divide-y">
        <li className="flex gap-3 p-5">
          <Check size={17} strokeWidth={2.5} className="text-allow mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-[14px] font-bold">
              The CFO approved plan {story.branch.label}. {paid?.vendor} was paid{' '}
              {usd(paid?.cents ?? 0)}, with a receipt.
            </p>
            <p className="text-muted mt-1 text-[13px]">
              Cash went from {usd(story.cashBeforeCents)} to {usd(story.cashAfterCents)}. That
              payment was authorized, and it went through.
            </p>
          </div>
        </li>
        {story.message ? (
          <li className="flex gap-3 p-5">
            <Mail size={17} strokeWidth={1.75} className="text-muted mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="text">UNTRUSTED INPUT</Chip>
                <span className="text-muted font-mono text-[11px] break-all">
                  {story.message.from}
                </span>
              </div>
              <p className="mt-1.5 text-[14px] font-bold">{story.message.subject}</p>
              <p className="text-muted mt-1 line-clamp-3 text-[13px] leading-relaxed">
                {story.message.body}
              </p>
            </div>
          </li>
        ) : null}
        {story.attempts.map((attempt) => (
          <li key={attempt.at + attempt.tool} className="flex gap-3 p-5">
            <Ban
              size={17}
              strokeWidth={2}
              className={`mt-0.5 shrink-0 ${attempt.enforcedBy === 'fork_mcp' ? 'text-fork-reject' : 'text-block'}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-[14px] font-bold">
                The agent tried <span className="font-mono">{attempt.tool}</span>
                {attempt.amountCents ? ` for ${usd(attempt.amountCents)}` : ''}
                {attempt.recipientId ? ` to ${attempt.recipientId}` : ''}.
              </p>
              <p className="text-muted mt-1 text-[13px]">{attempt.why}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                <span className="text-muted">ArmorIQ</span>
                <VerdictPill verdict={attempt.armoriq} />
                {attempt.enforcedBy ? (
                  <span className="text-muted">
                    stopped by <b className="text-text">{ENFORCERS[attempt.enforcedBy]}</b>
                  </span>
                ) : null}
                <span className="text-muted font-mono">{attempt.errorClass}</span>
                <span className="text-muted font-mono">{clock(attempt.at)}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-muted mt-3 text-[12px]">
        The plan ended partially committed: the remaining approved payments did not run after the
        agent&apos;s attempt.{' '}
        {story.armorPlanId ? (
          <>
            ArmorIQ plan <span className="font-mono break-all">{story.armorPlanId}</span>.
          </>
        ) : null}
      </p>
    </section>
  );
}

function StepRow({ step }: { step: ProofStep }) {
  return (
    <tr className="border-line border-t align-top">
      <td className="py-3 pr-4 font-mono text-[12px]">{step.tool}</td>
      <td className="py-3 pr-4">
        <VerdictPill verdict={step.armoriq} />
      </td>
      <td className="py-3 pr-4 text-[13px]">{OUTCOMES[step.outcome]}</td>
      <td className="py-3 pr-4 text-[13px]">
        {step.enforcedBy ? ENFORCERS[step.enforcedBy] : '—'}
        {step.errorClass ? (
          <div className="text-muted font-mono text-[11px]">{step.errorClass}</div>
        ) : null}
      </td>
      <td className="py-3">{step.matchedExpectation ? null : <Tag tone="gold">Unexpected</Tag>}</td>
    </tr>
  );
}

function LiveResult({ result }: { result: ProofResult }) {
  const { sandbox } = result.ledger;
  return (
    <div className="card mt-4 p-5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="accent">Run just now</Tag>
        <span className="text-muted font-mono text-[12px]">{clock(result.ranAt)}</span>
        {result.integrity === 'failed' ? <Tag tone="bad">Integrity check failed</Tag> : null}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="label">
              <th className="pr-4 pb-2 font-bold">Call</th>
              <th className="pr-4 pb-2 font-bold">ArmorIQ decision</th>
              <th className="pr-4 pb-2 font-bold">Final outcome</th>
              <th className="pr-4 pb-2 font-bold">Enforced by</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {result.steps.map((step) => (
              <StepRow key={step.tool} step={step} />
            ))}
          </tbody>
        </table>
      </div>
      <dl className="text-muted mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-[12px]">
        {result.capabilityCheck ? (
          <>
            <dt>Capability check</dt>
            <dd>
              approved arguments {result.capabilityCheck.originalArguments}, altered arguments{' '}
              {result.capabilityCheck.alteredArguments}. The approved payment itself was not sent.
            </dd>
          </>
        ) : null}
        <dt>Sandbox cash</dt>
        <dd>
          {usd(sandbox.cashBeforeCents)} before, {usd(sandbox.cashAfterCents)} after,{' '}
          {sandbox.postingsAdded} postings added
        </dd>
        <dt>ArmorIQ plan</dt>
        <dd className="font-mono break-all">{result.armorPlanId}</dd>
        <dt>Measured against</dt>
        <dd>
          {result.reference.vendor}, {usd(result.reference.amountCents)}, authorized by the demo
          harness, not by a person{' '}
          <HashChip value={result.reference.approvedPlanHash} label="Reference plan hash" />
        </dd>
      </dl>
    </div>
  );
}

function wait(error: unknown): string {
  if (!(error instanceof ApiFailure)) return String(error);
  const seconds = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  if (error.status === 429 && seconds)
    return `${error.message}. Try again in ${seconds} seconds. The recorded run above is unaffected.`;
  return `${error.message} The recorded run above is unaffected.`;
}

function Live() {
  const [attack, setAttack] = useState<Attack>('policy_blocked_tool');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const preset = PRESETS[attack];

  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      setResult(await runProof(attack));
    } catch (error) {
      setResult(null);
      setProblem(wait(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Live security probe" className="border-line border-t py-12">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="accent">Live</Tag>
        <span className="text-muted text-[12px]">A scripted probe, not an agent</span>
      </div>
      <h2 className="mt-3 text-[28px] leading-[1.12] font-extrabold sm:text-[32px]">
        Now run the check yourself
      </h2>
      <p className="text-muted mt-3 max-w-[68ch] text-[14px] leading-[1.8]">
        The call is fixed in advance; the enforcement is live. Each run first makes a governed
        balance read that ArmorIQ should allow, then the attempt you pick. It runs against a
        separate sandbox ledger and can never move money.
      </p>

      <fieldset className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Attempt to run</legend>
        {ATTACKS.map((item) => (
          <label
            key={item}
            className={`card flex cursor-pointer items-center gap-2.5 p-4 text-[14px] font-bold ${item === attack ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}
          >
            <input
              type="radio"
              name="attack"
              checked={item === attack}
              onChange={() => setAttack(item)}
            />
            {PRESETS[item].name}
          </label>
        ))}
      </fieldset>
      <div className="card mt-2 p-5">
        <p className="text-[14px]">
          <b>Sends:</b> {preset.sends}
        </p>
        <p className="text-muted mt-1.5 text-[13px]">
          <b>Should happen:</b> {preset.expect}
        </p>
        <Button variant="primary" className="mt-4" disabled={busy} onClick={() => void run()}>
          <Play size={14} strokeWidth={2.25} aria-hidden /> {busy ? 'Running…' : 'Run it now'}
        </Button>
      </div>

      {problem ? (
        <p role="alert" className="card text-block mt-4 p-4 text-[13px] font-bold">
          {problem}
        </p>
      ) : null}
      {result ? <LiveResult result={result} /> : null}
    </section>
  );
}

export function Proof({ story }: { story: RecordedStory }) {
  const paid = story.paid[0];
  return (
    <Shell active="Proof">
      <main className={wrap}>
        <header className="pt-14">
          <div className="eyebrow">Proof</div>
          <h1 className="mt-3 max-w-[18ch] text-[40px] leading-[1.04] font-extrabold tracking-[-0.04em] sm:text-[56px]">
            One approval. One attempted deviation.
          </h1>
          <p className="text-muted mt-5 max-w-[64ch] text-[15px] leading-[1.8]">
            A CFO approved paying {paid?.vendor} {usd(paid?.cents ?? 0)}. An email then told the
            agent to send money somewhere else, and the agent tried. The approved payment went
            through. The other one did not. Two different gates said no, and this page shows which
            was which.
          </p>
        </header>
        <Recorded story={story} />
        <Live />
      </main>
    </Shell>
  );
}
```

`usd` here is `usdShort`, so $4,000 reads as `$4,000` and not `$4,000.00`; the browser test depends on that. Check before moving on: `Chip`, `HashChip`, `Tag`, `VerdictPill`, `Button` and the `card`, `label`, `eyebrow` classes are all used the same way in `apps/web/components/landing.tsx`. If `Tag` has no `bad` or `gold` tone, it does: see `TONES` in `primitives.tsx`.

- [ ] **Step 8: Add the page and the menu entry**

Create `apps/web/app/proof/page.tsx`:

```tsx
import { Proof } from '@/components/proof';
import recorded from '@/data/recorded-run.json';
import { recordedStory, type RecordedRun } from '@/lib/proof';

export const metadata = { title: 'Proof · FORK' };

export default function ProofPage() {
  return <Proof story={recordedStory(recorded as unknown as RecordedRun)} />;
}
```

In `apps/web/components/chrome.tsx`, add the entry to `SITE`:

```ts
const SITE = [
  { name: 'Overview', href: '/' },
  { name: 'Proof', href: '/proof' },
  { name: 'How it works', href: '/how' },
] as const;
```

`Section` is derived from `SITE`, so `active="Proof"` type-checks once this is in.

- [ ] **Step 9: Run and see them pass**

Run: `pnpm test:e2e && pnpm typecheck && pnpm lint`
Expected: PASS, the three new tests and every existing one. `the header is one row on a phone` checks the header's height with the extra menu link; if it fails, the fix is in the header's layout, not in the test's limit.

- [ ] **Step 10: Look at it**

Run `pnpm dev:web` with the engine running, open `/proof` at 1440 and 390 wide in light and dark, and run one probe. Fix anything that overlaps or truncates. The screenshots from `bothThemes` are in `test-results/screenshots/proof-*.png`.

- [ ] **Step 11: Commit**

```bash
git add apps/web tests/e2e/pages.spec.ts
git commit -m "feat(web): a public proof page with the recorded attack and four live probes"
```

---

### Task 8: Point the landing page at it, cover it live, and write down what was seen

**Files:**

- Modify: `apps/web/components/landing.tsx` (hero links at ~75-87, evidence button at ~303)
- Modify: `tests/live/armoriq.live.test.ts`
- Modify: `README.md`, `docs/ARCHITECTURE.md`, `docs/TEST_EVIDENCE.md`

**Interfaces:**

- Consumes: `/proof` from Task 7, `POST /api/proof/run` from Task 6.

- [ ] **Step 1: Write the failing browser check**

In `tests/e2e/pages.spec.ts`, inside the test `landing at ${width}px shows the recorded run and has no dead links`, after the `IntentMismatchException` assertion:

```ts
await expect(page.getByRole('link', { name: 'See the proof' })).toHaveAttribute('href', '/proof');
await expect(page.getByRole('link', { name: 'Run the proof yourself' })).toHaveAttribute(
  'href',
  '/proof',
);
```

Run: `pnpm test:e2e -g "landing at"`
Expected: FAIL, no link named "See the proof".

- [ ] **Step 2: Change the two links**

In `apps/web/components/landing.tsx`, the hero's primary link becomes the proof and the studio moves to the secondary slot:

```tsx
            <Link
              href="/proof"
              className="bg-bright inline-flex h-11 items-center gap-2 rounded-[8px] px-5 text-[14px] font-extrabold text-[#133025] hover:opacity-90"
            >
              See the proof <ArrowUpRight size={16} strokeWidth={2.25} aria-hidden />
            </Link>
            <Link
              href="/app"
              className="border-panel-line hover:bg-panel-raised inline-flex h-11 items-center gap-2 rounded-[8px] border px-5 text-[14px] font-extrabold"
            >
              Open the decision studio <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
            </Link>
```

"How it works" stays in the site menu. In the `Evidence` section:

```tsx
<Link href="/proof" className={`${buttonClass('primary')} mt-6`}>
  Run the proof yourself <ArrowUpRight size={15} strokeWidth={2} aria-hidden />
</Link>
```

Run: `pnpm test:e2e`
Expected: PASS.

- [ ] **Step 3: Add the live cases**

In `tests/live/armoriq.live.test.ts`, add a describe after `live ArmorIQ`. It needs no login, which is the point:

```ts
describe.skipIf(!live)('live proof mode', () => {
  const probe = (attack: string) =>
    fetch(`${BASE}/api/proof/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attack }),
    });

  it('policy_blocked_tool: the platform policy blocks a forbidden tool that is in the plan', async () => {
    const response = await probe('policy_blocked_tool');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.steps[0]).toMatchObject({ armoriq: 'allow', outcome: 'executed' });
    expect(result.steps[1]).toMatchObject({
      armoriq: 'block',
      enforcedBy: 'armoriq_policy',
      errorClass: 'PolicyBlockedException',
      outcome: 'not_reached',
      matchedExpectation: true,
    });
    expect(result.ledger.sandbox.postingsAdded).toBe(0);
    expect(result.ledger.treasury.postingsAdded).toBe(0);
    console.log(`live policy block, plan ${result.armorPlanId}`);
  }, 60_000);

  it('altered_amount: ArmorIQ allows the tool and the MCP refuses the arguments', async () => {
    // the engine's cooldown applies to this suite too
    await sleep(Number(env.PROOF_COOLDOWN_SECONDS ?? 20) * 1000 + 1000);
    const response = await probe('altered_amount');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.capabilityCheck).toEqual({
      originalArguments: 'valid',
      alteredArguments: 'invalid',
    });
    expect(result.steps[1]).toMatchObject({
      armoriq: 'allow',
      enforcedBy: 'fork_mcp',
      errorClass: 'CAPABILITY_INVALID',
      outcome: 'refused',
      matchedExpectation: true,
    });
    expect(result.ledger.sandbox.postingsAdded).toBe(0);
    console.log(`live altered amount, plan ${result.armorPlanId}`);
  }, 90_000);
});
```

Run: `pnpm test`
Expected: PASS, with the live suite reported as skipped.

- [ ] **Step 4: Update the docs that are true without a live run**

In `docs/ARCHITECTURE.md`, add before `## Hosting`:

```md
## Proof Mode

`/proof` is public. Its default view is the recorded run of the real inbox agent. Below that, a
visitor can run one of four preset probes through `POST /api/proof/run`
(`apps/engine/src/proof.ts`).

- Probes are scripted. A probe is never described as something a model chose to do.
- They run against a separate scenario, `proof-sandbox`, with its own vendors, invoices and
  ledger. The CFO's books are never read or reset for a probe.
- The amounts are measured against a reference authorization made by the system
  (`proof-mode@fork.sandbox`), audited as `branch.authorized_by_system`. `commitBranch` refuses any
  system-authorized branch, so it can be probed and never paid.
- Each probe signs its own synthetic ArmorIQ plan and mints its own short-lived capability. An
  approved branch's steps and hash are never changed.
- The endpoint counts ledger postings in both scenarios around every probe. If one is ever added,
  Proof Mode switches itself off in the database and stays off until an administrator clears it
  with `POST /api/demo/proof-reset`.
- Limits: one probe at a time, a cooldown, and a cap per UTC day, all read from `proof_runs` so
  they survive a restart.

Only four routes are public, by exact method and path: `GET /api/health`,
`POST /api/auth/login`, `GET /api/auth/me`, `POST /api/proof/run`. Everything else needs the CFO
session, reads included.
```

In the threat model table in the same file, add one row:

```md
| A public visitor abusing the proof endpoint | Four presets and nothing else, a 1 KB body cap, a cooldown, a daily cap, one probe at a time. No preset can carry a capability that matches its arguments | It spends ArmorIQ quota up to the daily cap |
```

In `README.md`, where the app's pages or the demo are introduced, add:

```md
**Proof.** `/proof` needs no login. It shows the recorded attack by the real inbox agent, then lets
you run four preset probes against live ArmorIQ: a forbidden tool blocked by platform policy, an
altered recipient and an altered amount refused by FORK's payment server, and a tool outside the
signed plan refused inside the ArmorIQ SDK. Probes are scripted, run on a separate sandbox ledger,
and cannot move money.
```

Update the test counts on the `pnpm test`, `pnpm test:e2e` and `pnpm test:live` lines in `README.md` to what the three commands now report.

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm test:e2e`
Expected: all PASS. Run `pnpm format` if only formatting fails, then re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/web tests README.md docs/ARCHITECTURE.md
git commit -m "feat: lead with the proof page, cover it in the live suite, document it"
```

- [ ] **Step 7: The live run (needs the real ArmorIQ key and the hosted engine)**

This step needs a person with the `.env` and access to platform.armoriq.ai. Do not skip it and do not write its results from memory.

1. Deploy the branch to the hosted engine: pull, reinstall with the same filter, restart. The new migration and the sandbox seed apply on boot; the CFO's ledger is not reset.
2. Run: `RUN_ARMORIQ_LIVE_TESTS=1 ENGINE_URL=https://<host> pnpm test:live`
   Expected: the two `live proof mode` cases pass and print their plan ids. The older `live ArmorIQ` cases need a fresh ledger and may be run separately.
3. If `policy_blocked_tool` comes back with `matchedExpectation: false`, the `fork-treasury` policy is not active for the registered MCP. Fix it on the platform, not in the code.
4. On platform.armoriq.ai, look for the `policy_blocked_tool` plan id. If there is a row showing the block, screenshot it to `docs/proof/09-armoriq-proof-mode-policy-block.jpg` and add a line to `docs/proof/README.md`. If there is no row, say so in that README: finding B13 saw the Audit tab empty for these calls.
5. Add rows to the live table in `docs/TEST_EVIDENCE.md` with the real plan ids, in this form:

```md
| Proof Mode, `policy_blocked_tool` | Blocked by platform policy (`PolicyBlockedException`), MCP not called, no postings added | Plan `<id printed by the live suite>` |
| Proof Mode, `altered_amount` | Allowed by ArmorIQ, refused by the MCP with `CAPABILITY_INVALID`, no postings added | Plan `<id printed by the live suite>` |
```

6. Commit: `git add docs && git commit -m "docs: live evidence for proof mode"`

---

## What this plan does not do

- It does not merge `proof-mode` or deploy the web app. Both wait for a person.
- It does not change `tamperTest`, the `_approvals` workaround, or the `/how` copy.
