# Progress

```
PHASE 0 IN PROGRESS — 2026-10-10 22:29 IST
Built: pnpm workspace (apps/web, apps/engine, apps/finance-mcp, packages/shared,
  packages/armor-adapter). Spike-surface fork-finance-mcp with get_treasury_balance,
  list_invoices, execute_payment (stub, no ledger) and update_vendor_destination (stub).
  scripts/spike/run.ts for S0-S8. armoriq/policy.fork.yaml. FINDINGS Part A (17 items
  from reading the installed SDK).
Tests: 0 automated tests yet. Local smoke check of the MCP passed (401 without key,
  tools/list and tools/call with it). Spikes S0-S8: blocked, awaiting HUMAN TASK
  (ArmorIQ key, agent + MCP registration, policy, Amount Field).
ArmorIQ live: none yet.
Changed from spec: see below.
UI quality check: n/a (no UI this phase)
Next risk: IntentMismatchException is raised inside the SDK before any network call
  (FINDINGS A8), so the headline BLOCK may not show on the platform. S2 decides.
```

```
PHASE 0 EXIT GATE MET (pending one visual check) — 2026-10-10 23:07 IST
Built: MCP fixes found by the live spike: accept the registry's X-API-Key header, strip the
  proxy's _iam_context from JSON-RPC bodies. Policy file now mirrors the real platform schema.
Tests: 29 unit passed / 0 failed. Spikes: S0 S1 S2 S5 S6 S8 pass, S3 documented
  (params not bound), S4 and S7 blocked (no amount or recipient settings found yet).
ArmorIQ live: allow tokenId=2d98f33c8cc44eb8bf6524980c560fc1 (get_treasury_balance);
  block tokenId=26a09234166a49279e778c431ce56794 (PolicyBlockedException, proxy 403,
  update_vendor_destination).
Changed from spec: no registered agent (platform form rejects every method); policy targets
  the MCP server; policy schema differs from the docs. See FINDINGS Part B.
UI quality check: n/a (no UI this phase)
Next risk: nobody has looked at the platform's Activity/Observability view yet to confirm the
  allow and the block are visible there. HOLD may have to be cut (FINDINGS B10).
```

```
PHASE 1 STARTED EARLY — 2026-10-10 22:32 IST
Built: the parts of Phase 1 that do not depend on the spike. packages/shared: money
  (pro-rata split by largest remainder, USD formatting), canonical JSON, sha256 hash.
  packages/domain-finance: seed scenario, reference branches A/B/C, validation,
  simulation, feasibility, risk annotations.
Tests: 29 passed / 0 failed / 0 blocked (unit only, part of 11.1)
ArmorIQ live: none yet.
Changed from spec: cash path steps down once (see below).
UI quality check: n/a (no UI this phase)
Next risk: Phase 0 exit gate is still open, so this work sits ahead of an unpassed gate.
  Not built yet for Phase 1: db schema and seed, ledger postings, full MCP with
  capability checks, and the 11.1 / 11.3 tests that need them.
```

## History

The repo started on 2026-10-10 from an earlier spec (two MCP servers, Stripe test mode). It was
restructured the same day for `FORK_SPEC_FINAL.md`: one MCP, no Stripe, `armor-adapter` as the
only SDK importer.

## Pinned versions

Newest release published on or before 2026-09-26. `minimumReleaseAge` in `pnpm-workspace.yaml`
applies the same 14-day rule to transitive dependencies.

| Package                            | Version | Package                   | Version |
| ---------------------------------- | ------- | ------------------------- | ------- |
| next                               | 16.3.6  | react / react-dom         | 19.3.0  |
| tailwindcss / @tailwindcss/postcss | 4.3.3   | @xyflow/react             | 12.12.0 |
| recharts                           | 3.10.1  | motion                    | 13.4.4  |
| sonner                             | 2.0.8   | cmdk                      | 1.1.1   |
| lucide-react                       | 1.48.0  | hono                      | 4.13.9  |
| @hono/node-server                  | 2.1.1   | zod                       | 4.6.5   |
| ai                                 | 7.0.116 | @ai-sdk/openai-compatible | 3.0.57  |
| @modelcontextprotocol/sdk          | 1.30.1  | @armoriq/sdk              | 0.6.10  |
| typescript                         | 6.0.3   | vitest                    | 5.0.2   |
| tsx                                | 4.23.15 | eslint                    | 10.11.0 |
| typescript-eslint                  | 8.70.1  | prettier                  | 3.9.9   |
| @types/node                        | 26.6.3  |                           |         |

Chosen, installed in the phase that needs them: `better-sqlite3` 13.0.3, `drizzle-orm` 0.45.3,
`drizzle-kit` 0.31.11, `@types/better-sqlite3` 9.6.0, `@playwright/test` 1.63.0,
`@axe-core/playwright` 4.13.0. TanStack Table is not pinned yet.

## Changed from spec

- **Node 22.12+ (`.nvmrc` pins 24).** `ai` 7 needs Node 22+, Vitest 5 needs
  `^22.12 || ^24 || >=26`. Node 25 does not work with Vitest 5.
- **TypeScript 6.0.3, not 7.** `typescript-eslint` 8.70 supports `typescript <6.1.0`.
- **Packages export TypeScript source.** `build` outside the web app is `tsc --noEmit`; the engine
  and MCP run with `tsx`. Nothing is published, so there is no emit step to keep in sync.
- **`harness`, `domain-finance`, `db`, `domain-portfolio` do not exist yet.** They are created in
  the phase that fills them, not as empty shells.
- **`armor-adapter` exists already, with only a client factory.** The spike needs the SDK, and the
  rule is that only this package imports it.
- **Spikes use `invokeWithPolicy` for every call**, because plain `invoke` does not turn policy
  responses into typed exceptions (FINDINGS A15).
- **`FORK_SPEC_FINAL.md` is not in the repo.** It was pasted into the session, not saved as a file.
- **The 14-day cash path steps down once.** Every payment in a branch goes out today and the
  scenario has no incoming cash, so the path is opening cash on day 0 and cash-after from day 1.
  Late fees are reported as exposure and are not subtracted from cash, which is what makes branch
  B end at exactly $10,000 and C at exactly $8,000.
- **Percent late fees round half up to the cent**, on the unpaid part of the invoice.
