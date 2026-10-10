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
PHASE 2 COMPLETE — 2026-10-10 23:38 IST
Built: packages/harness (branch and step lifecycles with guards, approved plan hash, commit
  loop). packages/armor-adapter (toVerdict, gateway: sign, dispatch, close, health). Treasury
  domain adapter (branch to exact MCP steps). Harness tables and append-only audit events.
  apps/engine: createEngine (runs, proposals, simulate, authorize, commit runner, cancel,
  resume after restart, labeled tamper test), CFO session with CSRF, REST API, SSE with
  Last-Event-ID, health. Held large-payment tool in the MCP. scripts/api-run.ts, scripts/reset.ts.
Tests: 128 passed / 0 failed / 0 blocked. Covers 11.1, 11.2, 11.3, 11.4. The 11.2 and API
  tests run against an in-process stand-in for ArmorIQ that applies plan membership and policy
  and calls the real MCP code; verdicts still come from toVerdict. Live-provider suite (11.5)
  is not written yet.
ArmorIQ live: via the API, no UI. allow: get_treasury_balance and execute_payment $4,000
  (receipt rcpt_04909ec3..., commit plan fc493488-7a32-40a6-b9aa-8e736888f873). block:
  get_sandbox_messages (PolicyBlockedException, same plan). tamper plan
  68e37d51-c2a2-4d53-9bbd-3c2ca91de1c3: IntentMismatchException.
Changed from spec: see the list below.
UI quality check: n/a (no UI this phase)
Next risk: the platform policy still lists four tools, so a live commit stops at the inbox read.
  The happy path and HOLD need the HUMAN TASK (re-scan, allow three tools, hold the large one).
  Planner, inbox agent and replan are Phase 3 and need LLM_* env values.
```

```
PHASE 1 COMPLETE — 2026-10-10 23:22 IST
Built: packages/shared (money, canonical JSON, hashing, single-use HMAC execution capabilities).
  packages/domain-finance (seed scenario, reference branches, validation, simulation,
  feasibility, risk rules). packages/db (Drizzle schema and migrations for the ledger side,
  append-only triggers on postings, idempotent seed, double-entry posting helper).
  apps/finance-mcp with all seven tools and the execute_payment checks in one immediate
  transaction.
Tests: 65 passed / 0 failed / 0 blocked. Covers 11.1 and 11.3.
ArmorIQ live: allowed read through the proxy against the real ledger; altered-recipient payment
  passed ArmorIQ and was refused by the MCP (CAPABILITY_INVALID), ledger unchanged.
Changed from spec: see the list below (tables, replay rule, extra overpayment check).
UI quality check: n/a (no UI this phase)
Next risk: the three new tools (get_vendor, get_sandbox_messages, get_payment_receipt) are not in
  the platform policy yet, and its default is block. HOLD still has no amount threshold.
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
- **Only the ledger-side tables exist so far**: scenarios, vendors, invoices, ledger_postings,
  receipts, used_capabilities, messages. The harness tables (runs, branches, approvals, executions,
  audit events and the rest) come with the code that uses them in Phase 2.
- **Reset means deleting the database file.** Postings are append-only at the database level, so
  there is no in-place wipe.
- **A retried payment gets its receipt back before the single-use check.** The spec lists the
  capability check first and idempotency last, which would turn an honest retry into a denial. An
  exact retry (same capability, same key) returns the original receipt; a used capability with any
  other key is denied.
- **`execute_payment` also refuses to pay a vendor more than it is owed.** Not in the spec's list.
- **`execute_payment` has no invoice id**, so a payment is applied to the vendor's open invoices,
  oldest first.
- **`update_vendor_destination` refuses unconditionally inside the MCP** as well as being blocked by
  policy. It has no code path that writes.
- **HOLD is a split tool, not an amount rule.** The platform's policy editor can only hold a tool on
  every call. Payments above the scenario threshold go through `execute_large_payment`, which the
  policy holds; the MCP refuses large amounts on `execute_payment` and small ones on the large tool.
- **No registered agent.** The platform's Add AI agent form fails on every method. The SDK works
  with the API key alone and the policy targets the MCP server.
- **No users or integration_health tables.** The one CFO comes from env; health is computed on
  request, and "last verified" is the newest step ArmorIQ decided.
- **Branches cannot be edited at all**, so "an edit creates a new version" has nothing to test.
  Changing course means a new branch. The stored steps are re-hashed before signing and before
  every payment, and a mismatch stops the commit.
- **The base snapshot is read from the shared database, not through an ArmorIQ-guarded read.** The
  engine never writes ledger tables (a scan test enforces it); all writes go through the MCP.
- **A commit is refused as STALE when the books changed since the snapshot**, which is also what
  stops two branches spending the same cash.
- **The tamper test signs the approved steps again as its own ArmorIQ plan** instead of borrowing
  the commit's token, so it can be run any time after authorization and shows up as a separate,
  clearly named plan on the platform.
- **A hold nobody approves does not stop the branch.** That payment stays NOT_EXECUTED, the rest
  run, and the branch ends PARTIALLY_COMMITTED. A block or a tool refusal does stop it.
- **`/api/demo/fixture-branches`** (admin key) adds the three reference branches, labeled
  `fixture`, so the commit path can be exercised before the planner exists. `/api/demo/reset` is
  not an endpoint: `pnpm reset` deletes the database file.
