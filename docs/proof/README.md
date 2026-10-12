# Proof

Screenshots taken on 2026-10-12 from platform.armoriq.ai and from FORK running locally against the
real ArmorIQ service. Nothing here is mocked or edited, apart from cropping image 07.

| File                                               | What it shows                                                                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01-armoriq-policy-rules.jpg`                      | The active policy `fork-treasury` on the MCP `forkfinance-mcp`: six tools allowed, `execute_large_payment` held for human approval, `update_vendor_destination` blocked     |
| `02-armoriq-policy-active.jpg`                     | The policy list: `fork-treasury` is Active with 74 decisions in the last seven days                                                                                         |
| `03-armoriq-blocked-update-vendor-destination.jpg` | A plan that called `update_vendor_destination`, shown as Blocked by Policy Engine                                                                                           |
| `04-armoriq-held-actions.jpg`                      | Held Actions: a nine-step plan waiting on a person                                                                                                                          |
| `05-armoriq-held-plan-steps.jpg`                   | The same held plan opened: the nine signed steps, including `execute_large_payment`, with Approve and Reject                                                                |
| `06-armoriq-plan-root-hash.jpg`                    | The Proof tab of ArmorIQ plan `f3055a4d-f518-4986-a91d-743400e5219f`: root hash `cf202fa2…281b` and the committed steps                                                     |
| `07-fork-same-plan-and-hash.png`                   | FORK's record of the same run: the same ArmorIQ plan id, the same hash (`cf202f…281b`), the same nine steps, and what each attempt got back (allow, hold, block)            |
| `08-armoriq-agent-registered.jpg`                  | The agent registry: `forkfinance-bot`, Verified                                                                                                                             |
| `09-armoriq-proof-mode-plan.jpg` | Taken 2026-10-12 after Proof Mode went live. The platform's page for plan `5b9e86dc-4204-45b6-9a80-a8a8cb01ba7b`, a `policy_blocked_tool` probe run from `/proof`: agent `forkfinance-bot`, two calls, `get_treasury_balance` and `update_vendor_destination` |
| `10-armoriq-policy-active-after-proof-mode.jpg` | Taken at the same time. `fork-treasury` is the only active policy on `forkfinance-mcp`, with its one block rule, and 82 decisions in seven days |

## What to read into these, and what not to

- **The block rule is in image 01.** Image 03 on its own is weaker than it looks: the platform puts
  the same Blocked badge on other single-call plans that were never closed, including one that
  only called `get_treasury_balance`, which the policy allows. Read 03 together with 01.
- **Images 06 and 07 are the same run.** Image 06 does not show the plan id on screen; it was opened
  from the id that image 07 shows. The hash is the link between the two.
- **The run in image 07 used the fixture planner** and a deliberate tamper test, both labelled as
  such in the app. Its block is `IntentMismatchException`, which the SDK raises before any network
  call, so that particular block has no row on the platform.
- **The held plan in 04 and 05 is from an early run** and is still waiting. Approved holds appear on
  the Intent page as Allowed or Completed, decided by a named person.
- **Image 09 shows the plan, not the block.** The platform has the Proof Mode plans under the same
  ids FORK reports, with the right agent and the right two calls. It does not show that the second
  call was blocked by policy: the plan page reads "No policy fired", its Audit tab reads "No audit
  records", and the Activity log holds only `plan.created` and `plan.failed` for each plan. The
  "Failed" badge is FORK closing the probe's plan as failed when it is done, which it does for every
  probe, including the ones ArmorIQ allowed. The plan id is in the page's address, not on screen.
- **So the evidence for the policy block is the proxy's answer, not a platform record.** The engine
  got HTTP 403 and `PolicyBlockedException` for `update_vendor_destination` on that plan, and the
  payment server was never called. Image 10 shows the rule that produced it is active. A per-call
  "blocked by policy" row on the platform was looked for on 2026-10-12 and not found.
