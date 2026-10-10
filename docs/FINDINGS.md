# Findings

Where a finding contradicts `FORK_SPEC_FINAL.md`, the finding wins.

## Part A: what the installed SDK does (`@armoriq/sdk` 0.6.10)

Read from `node_modules/@armoriq/sdk/dist` (`*.d.ts` and `client.js`) on 2026-10-10. None of this
has been run against the live service yet. Part B is still to do.

| #   | Spec says                                                         | Installed SDK does                                                                                                                                                                                                                                                       | What we do                                                                                                                                                    |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | U1: are `userId` / `agentId` required?                            | Optional. Constructor takes `Partial<SDKConfig> & { apiKey?, useProduction? }`; missing IDs default to `'__sdk_multiuser__'`. Only `apiKey` is required and must start with `ak_live_`, `ak_test_` or `ak_claw_`, else `ConfigurationException` is thrown synchronously. | Pass `apiKey` and `agentId`; send `userEmail` per call.                                                                                                       |
| A2  | `capturePlan` returns `planHash` and `merkleRoot`                 | `capturePlan(llm, prompt, plan?, metadata?)` is synchronous and returns `{ plan, llm, prompt, metadata }`. Hashing is server-side in `getIntentToken`. `planHash` is `token.planHash`; the Merkle root is `token.rawToken.merkle_root`.                                  | `executions.armorPlanHash` and `merkleRoot` are filled from the token.                                                                                        |
| A3  | `getIntentToken(plan, { validitySeconds })`                       | Positional: `getIntentToken(planCapture, policy?, validitySeconds?)`.                                                                                                                                                                                                    | `getIntentToken(capture, undefined, 1800)`.                                                                                                                   |
| A4  | `invokeWithPolicy` takes `holdPollIntervalMs`, `holdPollAttempts` | Neither exists. Options are `{ waitForApproval, delegationTimeoutMs, onHold, userEmail, requesterRole, requesterLimit }`. Polling starts at 3 s and backs off x1.5 to 15 s.                                                                                              | Use `delegationTimeoutMs`. The UI countdown shows time left, not a fixed poll tick.                                                                           |
| A5  | `PolicyHoldException` exposes `delegationId`                      | It exposes `delegationContext`, `metadata`, `matchedPolicy`. The delegation ID arrives through `onHold(info)`, which fires twice: first without an ID, then with `info.delegationId`.                                                                                    | The `hold` verdict and delegation card are driven by `onHold`.                                                                                                |
| A6  | Hold timeout or denial                                            | With `waitForApproval`, a rejected, expired or timed-out hold throws `DelegationException` (has `delegationId`). Without `waitForApproval`, or without `userEmail`, a hold throws `PolicyHoldException` immediately.                                                     | `toVerdict()` handles `DelegationException`; the step ends `NOT_EXECUTED`. `userEmail` is always sent.                                                        |
| A7  | U2: are `params` bound to the plan?                               | No, per the SDK source. The step is found by `steps[i].action === action` (first match) and the Merkle leaf is the action name only. A comment in `client.js` (`#92`) says it "binds the action but NOT the call params".                                                | Never claim binding. Altered recipient or amount must be caught by recipient policy and by the MCP capability and args hash. S3 confirms what the proxy does. |
| A8  | `IntentMismatchException` for a tool not in the plan              | Thrown locally by the SDK, before any network call, when the action is not in the plan. A proxy-side path can also raise it.                                                                                                                                             | Risk, see below. S2 has to check the platform trace, not just the exception.                                                                                  |
| A9  | `TokenExpiredException`                                           | Also raised locally from `token.expiresAt`, before any network call.                                                                                                                                                                                                     | Same visibility caveat as A8.                                                                                                                                 |
| A10 | U4: MCP auth through the proxy                                    | `mcpCredentials: { '<mcp name>': { authType: 'api_key', apiKey, headerName } }`, sent to the proxy as `X-Armoriq-MCP-Auth`.                                                                                                                                              | `headerName: 'X-Fork-MCP-Key'`. S1 confirms the proxy forwards it under that name.                                                                            |
| A11 | U5: do `forUser` / sessions exist in TS?                          | Yes: `client.forUser(email)`, `client.startSession()`, `ArmorIQSession` with `local`, `proxy` and `sdk` modes.                                                                                                                                                           | Not used. `userEmail` per call.                                                                                                                               |
| A12 | U6: shape of a result                                             | `MCPInvocationResult { mcp, action, result, status, executionTime?, verified, metadata }`. No trace ID in the type.                                                                                                                                                      | Log raw results in S1 and look for a trace ref in `metadata`.                                                                                                 |
| A13 | U7: read decisions back?                                          | The SDK has an `observability` module that writes spans. No read API in the types.                                                                                                                                                                                       | Store our own record; deep-link to the console.                                                                                                               |
| A14 | Exception list                                                    | Two more exist: `DelegationException` and `RevokedTokenError` (proxy 401 on a revoked token).                                                                                                                                                                            | `RevokedTokenError` maps to `block`.                                                                                                                          |
| A15 | n/a                                                               | Only `invokeWithPolicy` turns policy responses into `PolicyBlockedException` / `PolicyHoldException`. Plain `invoke` rethrows the raw HTTP error.                                                                                                                        | Every call, reads included, uses `invokeWithPolicy`.                                                                                                          |
| A16 | n/a                                                               | The constructor validates the key in the background (not awaited), and the SDK logs to stdout on every call.                                                                                                                                                             | A bad key shows up on first use. S8 records how.                                                                                                              |
| A17 | U3: amount units                                                  | Tool metadata from the platform carries `amountFields`, `amountUnit`, `currency`, `recipientField`, `transactionType`. The SDK reads the amount from the configured field and sends it as `_policy_context.amount`.                                                      | Dollars in `amount` as specced. There is a recipient field setting too, which S7 depends on.                                                                  |

### From the platform UI (2026-10-10)

- **The MCP Registry form does not let you name the API-key header.** "API key" is always sent as
  `X-API-Key`; the other choice is a Bearer token. So the MCP now accepts the key in
  `X-Fork-MCP-Key`, `X-API-Key` or `Authorization: Bearer`. Which one the proxy uses at invoke time
  is still for S1 to show.
- **Add AI agent** offers: Connect by URL, Attached to MCP server, From plugin, Custom (manual).
  FORK's agent has no endpoint of its own, so it is registered as attached to `fork-finance-mcp`.

### Open risk for S2

If a locally-raised `IntentMismatchException` leaves no trace on the platform (A8), the block is
still real enforcement by the ArmorIQ SDK, but the "screenshot or trace proving a real ArmorIQ
block" has to come from a block the proxy sees. Options, best first:

1. `update_vendor_destination` blocked by policy when it is in a plan (S5). That is a spike-only
   plan; a real branch never contains the tool.
2. `execute_payment` to an unregistered recipient (S7). The tool is in the plan, so the call always
   reaches the proxy. This is also what the labeled tamper test does.
3. `ArmorIQSession` in proxy mode, which reports its decisions itself (A11).

## Part B: live spike results

Run on 2026-10-10 against production ArmorIQ (`proxy.armoriq.ai`), MCP reached through a Cloudflare
quick tunnel. No agent was registered: the client ran as `agent=__sdk_multiuser__`. S1, S2, S3, S6 and S8 ran with no policy active (`matched_policies: []`). S5 was re-run after the `fork-treasury` policy was activated.

| ID  | Test                                                     | Expected                  | Actual                                                                                                                                                                                                                                     | Conclusion                                                                           |
| --- | -------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| S0  | Construct the client                                     | OK                        | Constructed                                                                                                                                                                                                                                | PASS                                                                                 |
| S1  | Plan `[get_treasury_balance]`; invoke                    | Success                   | First runs: HTTP 400 `Parse error: Invalid JSON-RPC message` (see B2). After the fix: `status: success`, `verified: true`, and the MCP logged the call                                                                                     | PASS. Platform trace not checked yet                                                 |
| S2  | Invoke `list_invoices`, not in plan                      | `IntentMismatchException` | `IntentMismatchException: Action 'list_invoices' not found in the original plan`                                                                                                                                                           | PASS. Raised locally by the SDK, nothing reached the MCP (A8)                        |
| S3  | Plan pays `rcp-harbor` $100; invoke with `rcp-northline` | Record                    | Call resolved. The MCP received and "executed" the payment to `rcp-northline`                                                                                                                                                              | **Params are not bound.** With no policy, an altered recipient goes straight through |
| S4  | $12,000 payment, wait for approval                       | Hold                      | Not run, needs policy and a human                                                                                                                                                                                                          | Open                                                                                 |
| S5  | `update_vendor_destination` in plan                      | `PolicyBlockedException`  | Before the policy was activated: the call resolved and reached the MCP. After: HTTP 403 from the proxy, `PolicyBlockedException: Tool 'update_vendor_destination' denied by OPA: policy_constraints_not_satisfied`. The MCP was not called | PASS. A proxy-side block, so it should appear on the platform                        |
| S6  | 60 s token, wait 70 s                                    | `TokenExpiredException`   | `TokenExpiredException: Intent token expired 13.2s ago`                                                                                                                                                                                    | PASS. Raised locally (A9)                                                            |
| S7  | Payment to an unregistered recipient                     | Policy block              | Not run, needs policy                                                                                                                                                                                                                      | Open                                                                                 |
| S8  | Bad API key                                              | An error, never a result  | HTTP 401 at token mint, surfaced as `InvalidTokenException: Token issuance failed: Invalid or expired API key`                                                                                                                             | PASS. No token, so nothing can be invoked                                            |

### What the live runs showed

- **B1. A registered agent is not required.** Token minting and invoke both work with only the API
  key. The platform's Add AI agent form currently fails with "url must be a URL address" on every
  method we tried, so this matters. What a policy can target without an agent is still open.
- **B2. The proxy adds `_iam_context` to the JSON-RPC body.** It sends `initialize`, then
  `tools/call` with an extra top-level `_iam_context` (`allowed_tools`, `user_id`, `email`, `domain`,
  `matched_policies`). The MCP SDK's transport rejects unknown top-level fields, so the MCP now
  strips everything except the JSON-RPC fields before handing the message over.
- **B3. MCP auth works as planned (U4).** The proxy forwards the SDK's `mcpCredentials` as an
  `x-fork-mcp-key` header. The registry's own discovery scan uses `X-API-Key` instead.
- **B4. Plan hash equals Merkle root for a one-step plan,** and the hash does not change with the
  plan's `goal`: S1 and S2 had different goals and the same hash. The hash covers the steps.
- **B5. Result shape (U6):** `{ mcp, action, result: { content: [...] }, status, executionTime,
verified, metadata: { hasToolError } }`. No trace ID. The token carries `tokenId` and `planId`,
  which are the only references we can store.
- **B6. S3 settles U2.** FORK must never claim parameter binding. Altered arguments are stopped by
  the MCP's single-use capability and args hash, and by recipient policy if S7 shows it works.
- **B7. A bad key fails at mint with `InvalidTokenException`.** That is a setup failure, not a
  step verdict: commit must refuse to start, and it must not be shown as an ArmorIQ block.
- **B8. The platform's policy schema is not the one in the docs.** The editor produces a flat list:
  `scope { target_type: mcp, target: <mcp id>, caller: all }`, `default_action`, `priority`, and
  `rules: [{ tool, action }]` with actions allow, hold or block. No amount threshold, velocity or
  recipient fields. `armoriq/policy.fork.yaml` now mirrors what is actually active.
- **B9. A policy targeted at the MCP server is enforced for SDK calls** with no agent registered.
  A draft policy enforces nothing; it has to be activated.
- **B10. Still open:** the $10,000 hold (S4) and recipient validation (S7) have no home in this
  editor. Either ArmorPay's Policy Studio exposes them elsewhere on the platform, or HOLD is cut
  from the demo and unknown recipients are stopped by the MCP alone.
- **B11. Proof lives on the Intent page (U7).** Activity only logs `plan.created`. Intent lists every
  plan with an outcome and "Decided by". A blocked call shows the plan as Blocked by Policy Engine.
  The plan detail page shows the root hash (it matches `token.planHash`), an "Authorized vs
  attempted" view and an Audit tab. Plans created before the policy was activated all show as
  Blocked, even the ones that succeeded, so proof screenshots must come from a fresh run.
- **B12. Allowed plans stay "Running" until told otherwise.** `client.completePlan(planId)` returned
  200 and the plan then showed Completed. The commit runner should close every plan it opens.
- **B13. The Audit tab is empty for `invokeWithPolicy` calls.** It reads "No executed actions have
  been logged". The SDK's `ArmorIQSession.report()` posts to `/iap/audit`; to be tried in Phase 2.
- **B14. Holds exist (Intent has a Held Actions queue) but only per tool.** No amount threshold
  has been found anywhere on the platform so far.
- **B15. S3 re-run against the full MCP.** Same altered-recipient call, now carrying the capability
  minted for the approved args. ArmorIQ still let it through (the invoke resolved), and the MCP
  refused it with `CAPABILITY_INVALID`. The ledger did not change. So an altered payment is stopped
  by FORK's MCP, not by ArmorIQ, and the UI must label it that way (source `mcp`, not an ArmorIQ
  block). Note the SDK reports this as a resolved call with `status: 'error'` and
  `metadata.hasToolError: true`, so `toVerdict()` has to look at that flag: ArmorIQ allowed the
  call, the tool refused it.
- **B16. First full run through the engine API against live ArmorIQ (2026-10-10).** Branch B was
  authorized and committed with the platform policy still listing only the original four tools.
  Balance read: allow. Harbor Hosting $4,000: allow, receipt issued, ledger cash $50,000 to $46,000.
  `get_sandbox_messages`: `PolicyBlockedException` from the proxy, because unlisted tools fall to the
  policy's default block. The runner stopped there and the branch ended PARTIALLY_COMMITTED with six
  steps NOT_EXECUTED. A token was issued for a plan containing tools the platform had not scanned
  yet, so plan signing does not check tool registration.
- **B17. The labeled tamper test, live.** `update_vendor_destination` with a fresh token for the
  approved steps: `IntentMismatchException` (block, raised by the SDK). Altered recipient on
  `execute_payment`: allowed by ArmorIQ, refused by the MCP with `CAPABILITY_INVALID`.
- **B18. The Inventory page's tool list is stale; the backend is not.** After the MCP grew from
  four tools to eight, Inventory kept showing "4 of 4" and "Tools discovered 0" through several
  re-scans. The API (`/mcp/tools/<name>`, `/iap/sdk/bootstrap`) returns all eight. Trust the API and
  the policy editor, not that page.
- **B19. Agent registration per the docs** (`/platform/agents/add-agent`) wants the agent's base URL
  and detects its framework as A2A or MCP. The live wizard differs from the docs and has no URL
  field in the "Attached to MCP server" flow, which is why that flow cannot finish.
- **B20. S4, the hold, works end to end, with two workarounds.** Policy rule `execute_large_payment:
hold` makes the proxy return a hold (`held for approval by member policy rule`).
  1. The SDK's built-in wait (`waitForApproval`) fails with "amount must be at least 0.01": it reads
     the amount from the platform's tool metadata (`isFinancial`, `amountFields`), and we found no
     place to set that. The adapter now calls `createDelegationRequest` itself with the real amount,
     polls `getDelegationStatus`, re-invokes with `_delegation_id`, then `markDelegationExecuted`.
     These are all public SDK methods, the same ones the SDK's own wait uses.
  2. ArmorIQ refuses self-approval ("You cannot approve a plan whose delegation you requested"). The
     request is filed as `fork-agent@kettleandpine.test` (`ARMORIQ_REQUESTER_EMAIL`), which the
     backend accepts without it being a member, and the CFO approves under Intent, Held Actions.
- **B21. First fully committed branch through live ArmorIQ (2026-10-10).** Branch B, plan
  `68985108-689f-472f-aef7-d70ed9344679`: nine calls allowed, six receipts, Juniper Payroll $12,000
  held (delegation `320e1220-6cf3-4477-9adb-b0380cb40e10`) and paid only after approval on the
  platform. Ledger cash $50,000 to exactly $10,000, receipts total $40,000, postings sum to zero.
- **B22. Pasting YAML into the policy editor works**, despite its "preview only" header. The
  editor's own tool probe never reached our server.
