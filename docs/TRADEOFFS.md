# Tradeoffs

What was cut, changed or left weaker than the spec, and why. The running log is in
`docs/PROGRESS.md`; this is the short version.

## Enforcement

- **ArmorIQ does not bind arguments, so FORK does not say it does.** The headline block is a tool
  that is not in the signed plan. Altered arguments are stopped one layer down, by the MCP's
  single-use capability. The UI labels that refusal as the MCP's, not ArmorIQ's.
- **The hold is a split tool, not an amount rule.** The platform only holds a tool on every call.
  Payments over $10,000 use `execute_large_payment`; the MCP refuses the wrong tool for the amount.
  The threshold is therefore enforced by our MCP together with a per-tool ArmorIQ hold.
- **The hold flow uses the SDK's lower-level calls.** `createDelegationRequest`,
  `getDelegationStatus` and `markDelegationExecuted`, because the SDK's built-in wait sends a zero
  amount without tool metadata we could not configure.
- **The "tool not in plan" block is raised inside the SDK**, before any network call. It is real
  ArmorIQ enforcement, but the per-call decision does not appear on the platform. FORK marks the
  plan failed on ArmorIQ afterwards. A policy block does reach the proxy.
- **No registered agent.** The platform form would not complete. Plans show `__sdk_multiuser__`.
- **Recipient validation and velocity limits are not configured.** The policy editor has no place
  for them. The MCP checks the recipient itself.

## Scope

- **The portfolio domain is read-only and fixture-only.** `/app/lab` forks it through the same
  harness code as treasury, in the browser. It has no tools, so nothing is signed or run, and no
  model proposes its branches. The engine still runs treasury only.
- **Voice briefing: not built.** Stretch.
- **Branches cannot be edited.** Changing course means a new branch, so "an edit creates a new
  version" has nothing to do.
- **No users table.** One CFO from the environment. Demo authentication.
- **Reset is a script, not an endpoint.** The ledger is append-only at the database level, so a
  reset means deleting the file.

## Reads

- **The base snapshot is read from the shared database**, not through an ArmorIQ-guarded MCP read.
  The engine never writes ledger tables (a test scans for it); every write goes through ArmorIQ and
  the MCP. The commit itself does make guarded reads: the balance before and after, and the inbox.

## UI

- **Radix primitives instead of the shadcn CLI, and our own verdict notifier instead of Cult UI.**
  Same behavior, fewer moving parts.
- **Branches hang side by side from one trunk**, and on the landing page the graph is full width
  under the hero text. Both because three branch cards are unreadable in a narrow column.
- **The cash path is a single step down** with no fill. Every payment in a branch goes out today
  and the scenario has no incoming cash.
- **The desktop workspace scrolls slightly at 900px tall**, so the graph keeps a readable size.

## Model

- **The model is slow.** Minutes, not seconds, for the inbox agent in the recorded run.
- **The real planner has not proposed an infeasible branch**, so "Rejected by FORK" has only been
  shown with the reference fixture.
- **One recorded attack run.** The model took the bait once. We do not know how often it does.
- **The model is reached through an OpenCode Go subscription.** OpenCode describes Go as designed
  for coding agents. FORK identifies itself truthfully and sends the session id their docs ask for.
  That was the operator's choice; a paid OpenCode Zen model is the alternative.

## Testing

- **Browser and integration tests use a stand-in for ArmorIQ.** The live suite is separate, small,
  and needs a person for the hold approval.
- **No Lighthouse run. No automated keyboard-only pass.**
- **The BEC statistic on the landing page is only the loss figure**, which was checked against the
  FBI's report. The complaint count was not confirmed and is left out.

## Hosting

- **The engine and MCP run on a small shared VM, not a managed host.** One systemd service on one
  port, published over HTTPS with Tailscale Funnel. The live suite passed there. The Dockerfile and
  `railway.json` are an alternative path that has not been built or deployed.
- **SQLite on local disk.** On most hosts that means the ledger resets on redeploy unless a volume
  is attached. For a sandbox demo that is acceptable.
