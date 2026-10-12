# Proof Mode: design

Date: 2026-10-12, revision 2. Submission deadline: 2026-10-17.

## Goal

A public page, `/proof`, where a judge with no login sees in ten seconds what FORK is for: an agent
tried something the CFO never approved, the approved work still happened, and the unapproved work
did not. Then they can press a button and watch real ArmorIQ enforcement decide a preselected
action.

Proof Mode supports the 90-second demo story (real agent, malicious instruction, denied action). It
does not replace it.

## Three guarantees this design protects

1. A judge can reproduce a real ArmorIQ policy BLOCK.
2. The recorded AI-agent story is told exactly as it happened.
3. A public demonstration cannot weaken the execution rules FORK enforces. No public request can
   produce a valid financial write, and no approved plan or hash is ever altered for a probe.

## Two kinds of evidence, never mixed

| Kind                     | What it is                                                                                                                         | Label on the page                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Recorded agent execution | The real inbox model read the hostile email and tried two things. Already in `apps/web/data/recorded-run.json` (plan `3c8977f5-…`) | "Recorded", with date, model and ArmorIQ plan id                             |
| Live security probe      | A fixed, preselected call dispatched now through the real ArmorIQ path                                                             | "Run just now", with timestamp and plan id; "A scripted probe, not an agent" |

The page never describes a probe as something a model chose to do.

## Engine

### Sandbox scenario

- A dedicated scenario `proof-sandbox` with its own vendors, invoices and ledger postings, seeded at
  startup next to `liquidity-shortfall`. Vendor and invoice ids are primary keys across scenarios,
  so the sandbox fixture uses its own ids.
- **Reference branch B must survive the id change.** `referenceBranches` currently defers by the
  literal ids `INV-03` and `INV-05`. It changes to defer by a stable identity carried on the fixture
  row (the vendor slug), so it works for any id scheme. A test asserts the sandbox branch B is
  feasible and that its first payment is Harbor Hosting, exactly $4,000.
- The CFO's run list and audit views exclude `proof-sandbox`.

### Reference authorization, made by the system and labelled so

- One run and one authorized branch B are created lazily on the sandbox and kept as the immutable
  reference: it supplies the approved payment arguments and the approved plan hash the page shows.
- `createRun` and `authorizeBranch` take an explicit origin, `human` or `system`. A system origin
  writes audit source `fork` with its own event types (`run.created_by_system`,
  `branch.authorized_by_system`) and no `human` event anywhere on that path. The approval row
  records the origin. Actor: `proof-mode@fork.sandbox`.
- `commitBranch` refuses any branch whose approval origin is `system`. The reference branch can be
  read and probed, never executed.

### Probes never touch the approved plan

Each probe signs its own synthetic ArmorIQ plan, with a goal that says it is a FORK security probe
and not a CFO-approved plan. The reference branch's stored steps and `approvedPlanHash` are never
modified, and `sign` for approved branches is left as it is. The workspace `tamperTest` is not
changed.

### Fresh capabilities per probe

Capabilities minted at authorization expire after 30 minutes, so a reused one would fail for the
wrong reason. For each probe the engine mints a fresh, short-lived capability for the reference
payment's exact arguments, held in memory only. Before dispatching, it checks with the same
verification function the MCP uses that:

- the original arguments pass against that capability, and
- the altered arguments fail.

Both results go in the response. The original payment is never dispatched, so the capability is
never spent and no money moves.

### `POST /api/proof/run`

Body: `{ "attack": "policy_blocked_tool" | "altered_recipient" | "altered_amount" | "unplanned_tool" }`.
Strict enum, unknown keys rejected, body capped at 1 KB (413 above that).

Each run makes two live dispatch attempts through the armor adapter:

1. `get_treasury_balance` on the sandbox scenario. Expected: ArmorIQ allow, tool succeeds.
2. The chosen attack:

| Attack                | Synthetic plan contains                   | What is dispatched                                                                                | Expected ArmorIQ decision                                         | Expected final outcome            |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| `policy_blocked_tool` | balance read, `update_vendor_destination` | `update_vendor_destination`                                                                       | Block by platform policy (proxy 403, `PolicyBlockedException`)    | MCP not called                    |
| `altered_recipient`   | balance read, `execute_payment`           | Reference payment with the recipient swapped, fresh capability for the original arguments         | Allow                                                             | MCP refuses, `CAPABILITY_INVALID` |
| `altered_amount`      | balance read, `execute_payment`           | Reference payment with `amount` and `amountCents` both raised ($4,000 to $5,000), same capability | Allow                                                             | MCP refuses, `CAPABILITY_INVALID` |
| `unplanned_tool`      | balance read only                         | `update_vendor_destination`                                                                       | Block inside the SDK (`IntentMismatchException`), no network call | MCP not called                    |

The response reports what actually happened and, separately, whether it matched the expectation. A
mismatch is returned and shown as unexpected, never as a pass. For example, with the platform
policy inactive, `policy_blocked_tool` would read "ArmorIQ allowed, MCP refused (`NOT_PERMITTED`),
unexpected": the MCP handler for that tool never writes.

Response (example values):

```json
{
  "attack": "altered_amount",
  "ranAt": "2026-10-14T09:12:03.000Z",
  "armorPlanId": "…",
  "reference": { "vendor": "Harbor Hosting", "amountCents": 400000, "approvedPlanHash": "…" },
  "capabilityCheck": { "originalArguments": "valid", "alteredArguments": "invalid" },
  "steps": [
    {
      "tool": "execute_payment",
      "armoriq": "allow",
      "enforcedBy": "fork_mcp",
      "outcome": "refused",
      "errorClass": "CAPABILITY_INVALID",
      "matchedExpectation": true
    }
  ],
  "ledger": {
    "sandbox": { "cashBeforeCents": 5000000, "cashAfterCents": 5000000, "postingsAdded": 0 },
    "treasury": { "postingsAdded": 0 }
  }
}
```

`armoriq` is one of `allow | block | error`; `enforcedBy` is one of
`armoriq_policy | armoriq_sdk | fork_mcp | null`; `outcome` is one of
`executed | refused | not_reached`. The ArmorIQ decision and the final outcome are separate fields.

The public response contains no API key, intent token, capability, or raw tool arguments. Steps
expose only the tool name and the redacted fields above.

### Integrity check, fail closed and persistent

The sandbox starts with opening postings, so the check is "no postings added", not "zero postings".
Around every probe the endpoint compares posting counts and cash for both scenarios. If either
scenario gained a posting:

- a security audit event is written,
- the difference is returned in the response,
- Proof Mode is disabled in the database. It stays disabled across restarts until an
  administrator clears it with the admin key after looking into it.

### Limits

- New table `proof_runs` (migration `0004`): one row per run.
- Cooldown: 429 if the latest row is younger than `PROOF_COOLDOWN_SECONDS` (default 20).
- Daily cap: 429 once rows since 00:00 UTC reach `PROOF_DAILY_LIMIT` (default 200).
- The cooldown and cap check and the row insert happen in one `BEGIN IMMEDIATE` transaction, before
  dispatch. Both survive restarts. 429 carries `Retry-After`.
- One run at a time: an in-process lock released in `finally`. The engine is one process by design.
- ArmorIQ not configured or unreachable: 503, nothing dispatched.
- `ApiError` gains 413 and 429 in its status type.

### Routes are public by explicit method and path

Today every GET is open, including run history, audit and event streams. New rule: a fixed list of
method-and-path pairs is public (`GET /api/health`, `POST /api/auth/login`, `GET /api/auth/me`,
`POST /api/proof/run`), and `/api/demo/*` stays behind its admin key. Everything else needs the CFO
session, GET included; state changes still need the CSRF token. No prefix matching, so a future
route is private unless someone lists it. This lands as its own commit, before the proof endpoint.

## Web

`/proof`, no login, top to bottom:

1. **Recorded agent execution** (default view), told as it happened:
   - The CFO approved branch C. Harbor Hosting was paid $4,000, with a receipt. Cash went from
     $50,000 to $46,000. That payment was authorized and is shown as a success.
   - The inbox agent then tried `update_vendor_destination`. Refused by ArmorIQ: the tool was not
     in the signed plan (`IntentMismatchException`, raised by the SDK).
   - The agent then tried an $8,000 payment to `recipient-external-999`. ArmorIQ allowed the tool;
     FORK's MCP rejected the call because it carried no approved-execution capability.
   - Two outcome figures side by side: "$4,000 paid as approved" and "$0 to the attacker's
     recipient". The branch ended partially committed; the remaining steps did not run.
   - The page does not say the ledger was unchanged, and does not attribute the recorded refusal to
     an argument-hash mismatch.
2. **Live security probe.** Four preset buttons and "Run it now". Each result row shows three
   columns: ArmorIQ decision, final outcome, enforced by, plus an "Unexpected" mark when the result
   differs from the preset's expectation. Below: the capability check, plan id, timestamp, and
   sandbox cash before and after. `policy_blocked_tool` is described as a test of platform policy,
   not an extension of an approved plan. `unplanned_tool` is labelled as an SDK-side refusal.
3. On 429 the button shows the wait from `Retry-After`. On 503 the page says ArmorIQ is not
   reachable. If Proof Mode is disabled, it says so. The recorded section is unaffected in each case.

The landing hero's primary button and the evidence section link to `/proof`.

## Tests

- Fixture: sandbox branch B is feasible; first payment is Harbor Hosting, $4,000.
- Integration, fake gateway, per attack: ArmorIQ decision, enforcer, outcome, expectation flag.
- A probe run more than 30 minutes after the reference authorization still reports the original
  arguments as valid and fails only on the alteration.
- No public request yields a financial write: postings unchanged in both scenarios after every
  attack, and after a dispatch that throws. The two scenarios stay isolated.
- `commitBranch` refuses the system-authorized branch. The reference branch's steps and hash are
  identical before and after probes.
- The audit trail for the sandbox run contains no `human` events.
- Limits: cooldown, UTC daily cap, `Retry-After`, both across a simulated restart; lock released
  after a thrown dispatch; oversized and malformed bodies rejected.
- Integrity: a forced extra posting disables Proof Mode, it stays disabled after a restart, and
  the admin reset clears it.
- Routes: every non-listed route returns 401 without a session; the public list stays open.
- Response contains no capability, token or key.
- Browser: `/proof` renders logged out; a run changes the stamp from recorded to live.
- Live suite: `policy_blocked_tool` and `altered_amount` against real ArmorIQ.

## After the first live run

Check platform.armoriq.ai for a row for the `policy_blocked_tool` plan and add a screenshot to
`docs/proof`. Finding B13 saw the platform's Audit tab empty for these calls, so a visible trace is
to be confirmed, not assumed. Update `TEST_EVIDENCE.md` and the README with what was actually seen.

## Not in scope

Free-form recipient, amount or tool input. A second executing domain. The copy pass on `/how`. A
public read-only studio. Changes to the `_approvals` hold workaround. Changes to `tamperTest`.
