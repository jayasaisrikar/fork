# FORK

**Explore every outcome. Commit only one.**

FORK lets an AI agent explore several financial futures before anything real happens. A planner
agent proposes branches, FORK simulates each one against the same frozen copy of the books, and a
human authorizes exactly one. A deterministic runner then commits that branch through an MCP
server, with ArmorIQ checking every call against the signed plan and the company's policy.

Built for ArmorIQ's Flow State 2026 hackathon. Fictional company. Sandbox ledger. No real payments.

## What happens in a run

Kettle & Pine Supply Co. has $50,000 in cash and $68,000 of invoices due this week.

1. **Fork.** The planner (an LLM) proposes up to three ways to handle the invoices.
2. **Simulate.** Each branch runs against the same snapshot. A branch that overdraws the account is
   marked "Rejected by FORK" and cannot be authorized.
3. **Authorize.** The CFO approves one branch. Its exact steps are frozen and hashed.
4. **Execute.** FORK captures those steps as an ArmorIQ intent plan, gets a signed token, and sends
   each step through ArmorIQ to the payment MCP. Cash changes only when a receipt comes back.
5. **Hold.** Payments over $10,000 wait for a person on the ArmorIQ platform.
6. **Attack.** A fake vendor email arrives mid-run. The inbox agent (an LLM, deliberately naive)
   tries to redirect the payment. ArmorIQ blocks the tool that was never in the signed plan.
7. **Replan.** The agent may propose a new branch. Running it needs a new authorization.

## Architecture

```
Browser ──(session cookie + CSRF)──► engine API ──► harness (lifecycles, approval checks)
                                          │
        Planner / inbox agent (LLM) ──► proposals and attempts only ──► harness
                                          │   CFO authorizes one immutable branch
                                          ▼
                               armor-adapter: capturePlan → getIntentToken
                                          │   per step: invokeWithPolicy
                                          ▼
                               ArmorIQ proxy (signed plan + policy)
                              ALLOW │   HOLD (approve on platform)   BLOCK
                                    ▼
                    fork-finance-mcp (single-use capability, recipient, cash, idempotency)
                                    ▼
                        sandbox ledger (append-only postings) ──► receipt
```

| Path                        | What it is                                                  |
| --------------------------- | ----------------------------------------------------------- |
| `apps/web`                  | Next.js: home, decision studio, receipts, activity, lab     |
| `apps/engine`               | Hono: API, SSE, commit runner, planner and inbox agents     |
| `apps/finance-mcp`          | `fork-finance-mcp`, the MCP server ArmorIQ calls            |
| `packages/harness`          | Domain-agnostic lifecycles, plan hash, commit loop, dry run |
| `packages/domain-finance`   | Pure treasury simulation, rules, fixtures                   |
| `packages/domain-portfolio` | A second, read-only domain: rebalancing dry run, no tools   |
| `packages/armor-adapter`    | The only place `@armoriq/sdk` is imported                   |
| `packages/db`               | Drizzle schema, migrations, seed, ledger helpers            |
| `packages/shared`           | Money, canonical JSON, hashing, execution capabilities      |

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), including the threat model.

## How ArmorIQ is used

| What                                                            | Where                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Client construction, MCP credentials                            | [`packages/armor-adapter/src/client.ts`](packages/armor-adapter/src/client.ts) |
| Plan capture and intent token (`capturePlan`, `getIntentToken`) | `sign()` in [`gateway.ts`](packages/armor-adapter/src/gateway.ts)              |
| Every tool call (`invokeWithPolicy`)                            | `dispatch()` in [`gateway.ts`](packages/armor-adapter/src/gateway.ts)          |
| Hold: delegation request, polling, re-invoke                    | `afterApproval()` in [`gateway.ts`](packages/armor-adapter/src/gateway.ts)     |
| The one function that creates verdicts                          | [`verdict.ts`](packages/armor-adapter/src/verdict.ts)                          |
| Closing a plan (`updatePlanStatus`)                             | `close()` in [`gateway.ts`](packages/armor-adapter/src/gateway.ts)             |
| Policy active on the platform                                   | [`armoriq/policy.fork.yaml`](armoriq/policy.fork.yaml)                         |
| Where the runner calls the gateway                              | `runExecution()` in [`apps/engine/src/service.ts`](apps/engine/src/service.ts) |

Every ALLOW, HOLD and BLOCK shown anywhere comes from a real ArmorIQ response or exception. If
ArmorIQ is unreachable or not configured, commit is disabled and the UI says why. FORK's own
refusals are labeled "Rejected by FORK" and the MCP's as "refused by the MCP", never as an ArmorIQ
verdict.

## Setup from a clean clone

Requires Node 22.12+ (`.nvmrc` pins 24) and pnpm 10.

```sh
nvm use
pnpm install
cp .env.example .env
```

Fill in `.env`:

| Variable                                                              | What                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `ARMORIQ_API_KEY`                                                     | From platform.armoriq.ai                                              |
| `CFO_EMAIL`, `CFO_PASSWORD`                                           | The demo CFO. Use your ArmorIQ login email so you can approve holds   |
| `ARMORIQ_REQUESTER_EMAIL`                                             | The agent's identity for hold requests. Must differ from the approver |
| `FORK_MCP_KEY`, `MCP_CAPABILITY_SECRET`, `DEMO_ADMIN_KEY`             | `openssl rand -hex 32` each                                           |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_PLANNER`, `LLM_MODEL_INBOX` | Any OpenAI-compatible endpoint                                        |

Then onboard on ArmorIQ: see [docs/ARMORIQ_SETUP.md](docs/ARMORIQ_SETUP.md). In short: expose the
MCP over HTTPS, register it as `fork-finance-mcp` (or set `FORK_MCP_NAME` to the name you
registered), and paste the policy.

Run it, in three terminals:

```sh
pnpm dev:mcp       # payment MCP on :8797
pnpm dev:engine    # engine on :8790
pnpm dev:web       # web on :3000
```

Open http://localhost:3000/app and sign in as the CFO. `pnpm reset` (with the engine and MCP
stopped) wipes the sandbox ledger.

## Tests

```sh
pnpm test          # 154 unit and integration tests, no network
pnpm test:e2e      # 14 browser tests (Playwright), against an in-process ArmorIQ stand-in
RUN_ARMORIQ_LIVE_TESTS=1 pnpm test:live   # 5 tests against real ArmorIQ; needs a fresh ledger
pnpm spike         # the Phase 0 spikes against real ArmorIQ
pnpm agent-check   # asks the configured model for branches and shows it the hostile email
```

Without `RUN_ARMORIQ_LIVE_TESTS=1` the live tests are reported as skipped, never as passed.
Results and evidence are in [docs/TEST_EVIDENCE.md](docs/TEST_EVIDENCE.md).

## What we found out about ArmorIQ

Full detail in [docs/FINDINGS.md](docs/FINDINGS.md). In plain words:

- **ArmorIQ binds the tool name to the signed plan, not the arguments.** A call planned for one
  recipient and sent to another passes ArmorIQ. FORK does not claim parameter binding. Altered
  payments are stopped by the MCP, which accepts only a single-use capability tied to the exact
  approved arguments.
- **A tool that is not in the plan is refused by the SDK before any network call**
  (`IntentMismatchException`). A tool blocked by policy is refused by the proxy
  (`PolicyBlockedException`).
- **Policy is a per-tool allow, hold or block.** We found no amount threshold on the platform, so
  payments over $10,000 go through a second tool, `execute_large_payment`, which the policy holds.
  The MCP enforces which tool a given amount must use.
- **Holds needed two workarounds**: the adapter opens the approval request itself with the real
  amount, and files it under the agent's identity because ArmorIQ refuses self-approval.
- **The agent is registered from config, not the form.** The platform's Add AI agent form failed on
  every method we tried, so `forkfinance-bot` is registered with `armoriq.yaml` and
  `armoriq register`. The policy targets the MCP server. Screenshots are in
  [docs/proof](docs/proof/README.md).

## Limits

- Sandbox only: fictional company and vendors, a local SQLite ledger, no payment rails.
- Demo authentication: one CFO, password from the environment.
- The base snapshot is read from the shared database, not through an ArmorIQ-guarded read.
- The engine and the MCP share one SQLite file, so they are deployed together.
- The second domain (portfolio) is a dry run on fixture data. It has no tools, no model and no
  ArmorIQ path. `/app/lab` shows it next to treasury through the same harness code.
- The engine and MCP are hosted on a small shared VM. See [docs/DEPLOY.md](docs/DEPLOY.md).
- See [docs/TRADEOFFS.md](docs/TRADEOFFS.md).

## Pre-existing code

None. Everything in this repository was written during the hackathon, on top of open-source
libraries.

## Tools used

TypeScript, pnpm, Next.js, Tailwind CSS, Radix UI, React Flow (`@xyflow/react`), TanStack Table,
Recharts, Motion, cmdk, Hono, Drizzle ORM, better-sqlite3, the Vercel AI SDK, the MCP TypeScript
SDK, the ArmorIQ SDK, Vitest, Playwright and axe.
