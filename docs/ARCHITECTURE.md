# Architecture

## Principles

- AI proposals are untrusted data.
- Simulation is never execution.
- Two separate gates must both pass before money moves: a human authorizes an immutable branch
  (FORK), and every call is checked against the signed plan and policy (ArmorIQ).
- Committed state changes only after a receipt from the MCP.
- The ledger and the audit log are append-only. The database refuses updates and deletes on both.

## Who can do what

| Part              | Can                                                                         | Cannot                                    |
| ----------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| Planner (LLM)     | Read the books it is handed, return a proposal                              | Call tools, see tokens, write anything    |
| Inbox agent (LLM) | Try `execute_payment` and `update_vendor_destination`, each through ArmorIQ | See tokens, capabilities or the database  |
| Harness           | Validate, simulate, check approvals, run approved steps in order            | Skip the approval or the ArmorIQ call     |
| armor-adapter     | Sign plans, dispatch calls, turn responses into verdicts                    | Be bypassed: nothing else imports the SDK |
| fork-finance-mcp  | Post to the ledger after its own checks                                     | Be called by the engine directly          |
| CFO               | Authorize a branch, approve holds on the ArmorIQ platform                   | Approve a hold inside FORK                |

## A commit, step by step

1. The planner returns typed allocations. The harness validates them against the snapshot: known
   invoices only, no overpayment, whole cents, approved vendors.
2. Each branch is simulated against the same snapshot. An infeasible one is marked
   "Rejected by FORK" and can never be authorized.
3. The CFO authorizes a branch. FORK turns it into exact MCP steps and computes
   `approvedPlanHash = sha256(canonical({branchId, version, baseSnapshotHash, steps, currency, actorId}))`.
4. FORK mints one execution capability per payment:
   `HMAC(MCP_CAPABILITY_SECRET, runId | stepIndex | argsHash | exp)`. It travels in the step's
   `approvedExecutionRef` and the MCP accepts it once.
5. The adapter calls `capturePlan` and `getIntentToken`. The token never leaves the adapter.
6. The runner, which is plain code, takes each step in order: re-checks the approval and the cash,
   calls `invokeWithPolicy`, maps the result with `toVerdict()`, stores the step and an audit event.
7. After the first payment the runner reads the inbox. New mail goes to the inbox agent. Anything
   the agent tries is a real call through ArmorIQ with the current plan, and any attempt halts
   the branch.
8. A block or a tool refusal stops the branch; the remaining steps are `NOT_EXECUTED`. A hold
   nobody approves leaves that one payment unpaid and the rest continue.
9. The plan is closed on ArmorIQ as completed or failed, and the ledger is reconciled.

## Lifecycles

Branch: `PROPOSED → SIMULATED → APPROVED → COMMITTING → COMMITTED | PARTIALLY_COMMITTED | BLOCKED | CANCELLED`.
Any pre-commit state can also become `INFEASIBLE` or `STALE`.

Step: `PENDING → AUTHORIZING → ALLOWED | HELD | DENIED | FAILED`, then `EXECUTED` or `NOT_EXECUTED`.

Every transition goes through a typed guard. A refused transition throws and is written to the
audit log as a security event.

## What `execute_payment` checks

Inside one `BEGIN IMMEDIATE` transaction, first failure wins, nothing is written on failure:

1. The capability is genuine, unexpired and matches the hash of these exact arguments.
2. If it was already used: an exact retry gets its original receipt back, anything else is denied.
3. The vendor is approved and the recipient is the registered one.
4. `amountCents` equals `round(amount * 100)`.
5. The amount uses the right tool: over the hold threshold it must be `execute_large_payment`.
6. The vendor is owed at least this much.
7. Cash stays at or above zero.

Then it writes balanced postings, applies the payment to the vendor's invoices, and a receipt.

## Threat model

| Threat                                   | Mitigation                                                                                                                                                              | What remains                                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Prompt injection through the inbox       | Messages are data and never change vendor records. The agent's tools go through ArmorIQ; a tool outside the plan is refused                                             | The model may still try. That is expected and is what the demo shows |
| The agent alters arguments               | ArmorIQ does not bind arguments (spike S3). The MCP's single-use capability is tied to the hash of the approved arguments, and the recipient must be the registered one | Depends on `MCP_CAPABILITY_SECRET` staying secret                    |
| Calling the MCP directly, around ArmorIQ | The MCP key, plus the capability, which only the engine can mint                                                                                                        | A leaked key and secret together. Rotate both                        |
| A stale authorization                    | The books are hashed. A commit is refused as `STALE` if they changed since the snapshot                                                                                 | None known                                                           |
| Replay or double payment                 | Idempotency keys, single-use capabilities, `BEGIN IMMEDIATE`                                                                                                            | None known                                                           |
| Editing an approved branch               | The stored steps are re-hashed before signing and before every payment                                                                                                  | None known                                                           |
| A forged CFO                             | Server session in an httpOnly cookie, CSRF token on every state change, no client-side role                                                                             | Demo authentication only: one account, password from the environment |
| Token expiry                             | A token is re-minted only for an unchanged approved plan                                                                                                                | None known                                                           |
| ArmorIQ unreachable                      | Fail closed: commit refuses to start and nothing is paid                                                                                                                | The demo cannot run while ArmorIQ is down                            |
| A hold approved by the requester         | ArmorIQ refuses self-approval. The agent files the request, a person approves it                                                                                        | The requester identity is a config value, not a verified account     |

## Hosting

The engine and the MCP share one SQLite file, so they run in one process on one port
(`scripts/serve.ts`, `Dockerfile`): the engine at `/api`, the MCP at `/mcp`. ArmorIQ's proxy needs
the MCP at a public HTTPS URL. The web app is hosted separately and talks to the engine over HTTPS
and SSE. What is actually running is in [DEPLOY.md](DEPLOY.md).

## A second domain

`packages/domain-portfolio` implements the same `ForkDomainAdapter` for a portfolio rebalance. Its
`toToolSteps` returns nothing, so there is nothing to approve, sign or run: the domain is read-only
by construction, not by a flag. `dryRun()` in `packages/harness/src/dry-run.ts` validates,
simulates and applies the lifecycle guard for any adapter, and `/app/lab` runs both domains through
it in the browser. The engine itself is wired to treasury only.
