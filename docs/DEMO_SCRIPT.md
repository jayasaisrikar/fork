# The 90-second video

Record at 1440×900, dark workspace, real UI only. No mocked screens.

## Before recording

1. Stop the engine and MCP, run `pnpm reset`, start them again. Cash should read $50,000.
2. Check the health indicator says "Enforcement ready".
3. Have platform.armoriq.ai open on **Intent, Held Actions** in a second window.
4. Decide which take you are recording. They cannot be the same take: the attack halts the branch
   before the held payment is reached.

Two things to know about timing:

- **The model is slow.** The recorded run took more than ten minutes end to end. Time a propose
  before you record, and either cut the wait in the edit or start once the branches are on screen.
- **The inbox agent is slow too.** In the recorded run about five minutes passed between its two
  attempts. Cut it, and say in the voiceover that it is cut.

## Take 1: the happy path with a hold (about 45 seconds)

| Time      | Screen                                                       | Voiceover                                                                             |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 0:00–0:10 | Workspace: $50,000 cash, $68,000 due. Click Propose branches | "Kettle & Pine can't pay every bill this week. The agent forks the decision."         |
| 0:10–0:22 | Branches appear. Simulate. Open Compare, Cash path           | "Every branch is simulated on a copy of the books before anything moves."             |
| 0:22–0:32 | Select a branch, Authorize, confirm. The seal draws          | "The CFO authorizes one branch. Its exact steps become a signed ArmorIQ intent plan." |
| 0:32–0:40 | Commit. ALLOW rows stream in, cash drops                     | "Each payment goes through ArmorIQ to the MCP. Cash changes only on a receipt."       |
| 0:40–0:50 | Hold card. Switch windows, approve on ArmorIQ, switch back   | "Anything over ten thousand dollars waits for a person in ArmorIQ."                   |

## Take 2: the attack (about 40 seconds)

Reset first.

| Time      | Screen                                                                                     | Voiceover                                                                                     |
| --------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 0:50–1:00 | Authorize a branch. Click Inject hostile message. Open the message                         | "A fake email asks to redirect a vendor's payment."                                           |
| 1:00–1:14 | Commit. The agent's row appears: `update_vendor_destination`, BLOCK. Red stub on the graph | "The agent believes it and tries. ArmorIQ refuses: that tool was never in the signed branch." |
| 1:14–1:22 | Replan from here. A dashed child branch appears. Open the run record, Reconciliation       | "The agent can propose a new branch. Running it needs a new signature."                       |
| 1:22–1:30 | Landing headline                                                                           | "Explore every outcome. Commit only one."                                                     |

## If the model does not take the bait

It is a real model, so it may not. The **Run tamper test** button sends the same two attempts
through the real ArmorIQ path, labeled as a deliberate security test. Use it and say so. Do not
present it as spontaneous agent behavior.

## A note on "Pay everything"

The spec's script shows a branch that overdraws the account being rejected by FORK. The real
planner did not propose one in either recorded run; it only proposed feasible branches. To show
the rejection, either run until the model proposes an infeasible branch, or start the engine with
`FORK_FIXTURE_PLANNER=1`, in which case the branches are labeled "Fixture" on screen and the
voiceover should not call them the agent's.

## Proof screenshots for the submission

Save to `docs/proof/`:

- The Intent page showing a plan **Blocked** by Policy Engine, from a fresh run.
- A plan detail page with the root hash visible, next to the same hash in FORK's inspector.
- Held Actions with the $12,000 request, and the same plan after approval.
