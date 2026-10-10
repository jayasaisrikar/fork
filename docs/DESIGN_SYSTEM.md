# Design system

FORK should read as a calm financial product that a first-time viewer can follow without a
walkthrough: one question at the top of the page, one primary action, and the proof one step
below the plain-language answer.

## Principles

- **Say it plainly first, prove it right underneath.** Every tool call is a sentence ("Paid Harbor
  Hosting $4,000") with the tool name, verdict and error class on the next line.
- **One next step.** The studio has a single primary button. Its label says what it does and the
  line under it says what happens after. A disabled button says why.
- **Who said no is never blurred.** FORK's rejection, ArmorIQ's block, ArmorIQ's hold and the MCP's
  refusal are four labels in different colors.
- **Numbers are FORK's, words are the agent's.** The agent's rationale is always labelled as
  unverified.

## Pages

| Page            | Route            | Job                                                               |
| --------------- | ---------------- | ----------------------------------------------------------------- |
| Home            | `/`              | The idea, the recorded real run, and the moment a call is refused |
| Decision studio | `/app`           | Explore, approve, execute, review                                 |
| Decisions       | `/app/runs`      | Every run and its outcome                                         |
| Receipt         | `/app/runs/[id]` | What was paid, what was stopped, then the full evidence           |
| Activity        | `/app/audit`     | The append-only event log, filterable and exportable              |
| How it works    | `/how`           | The harness, the four kinds of refusal, the adapter contract      |

The studio is one column of cards beside a sticky selected-plan panel: situation bar, plan cards
(or the branch map), comparison, bills, activity, safeguard tests. On a phone the panel moves under
the plan cards and the primary button sits in a bar at the bottom.

## Color

Defined as CSS variables in `apps/web/app/globals.css`. Components use the tokens, never a hex.

| Token           | Light     | Dark      | Use                                      |
| --------------- | --------- | --------- | ---------------------------------------- |
| `--bg`          | `#F5F7F4` | `#111B16` | Page                                     |
| `--surface`     | `#FFFFFF` | `#1A2921` | Cards                                    |
| `--raised`      | `#EDF2ED` | `#22342A` | Hover, active nav                        |
| `--line`        | `#DCE5DE` | `#34473A` | Borders                                  |
| `--text`        | `#15251E` | `#E5F1E8` | Body                                     |
| `--muted`       | `#55665C` | `#9CAF9D` | Labels, secondary text                   |
| `--accent`      | `#276C52` | `#9CE6AD` | Selection, the approval seal, eyebrows   |
| `--mint`        | `#E8F4E9` | `#234131` | Selected card, soft highlights           |
| `--ink`         | `#13251D` | `#C5EACB` | Primary button, current step             |
| `--allow`       | `#17694A` | `#8FE0A6` | ALLOW, paid                              |
| `--hold`        | `#7D5A12` | `#EAD39B` | HOLD, part paid                          |
| `--block`       | `#A8442F` | `#FFA89D` | BLOCK, negative money                    |
| `--fork-reject` | `#6B3F86` | `#D3B0E6` | FORK's and the MCP's own refusals        |
| `--panel`       | `#12251D` | `#0C1510` | The dark band: hero, situation bar, code |

Rules:

- **Approve is accent. Allow is green.** A decision is not an enforcement outcome.
- A refusal that did not come from ArmorIQ never wears an ArmorIQ verdict color.
- Status always has a text label. Color is never the only signal.
- Tags are a 11% tint of their own color on the surface, so they hold contrast in both themes.

Every page is light first, with a dark theme behind the toggle. The choice is remembered.

## Type

| Role | Face                           | Where                                    |
| ---- | ------------------------------ | ---------------------------------------- |
| UI   | Manrope 400 to 800             | Everything; headings are 800, tight      |
| Data | IBM Plex Mono, tabular figures | Money in tables, ids, hashes, tool names |

Big figures (cash left, totals) use Manrope 800 with tabular digits. Labels are 11px uppercase with
0.1em tracking. Hashes show the first six and last four characters, with copy on click and the full
value in a tooltip.

## Shape and motion

- Radius 12px on cards, 8px on buttons and inputs, 6px on tags. Borders separate things; shadows
  are only on popovers and dialogs.
- Motion is limited to the seal drawing in, activity rows sliding in, the verdict notifier, and the
  loading shimmer. Nothing fades text. `prefers-reduced-motion` turns it off.

## Components

`Button`, `Tag`, `VerdictPill`, `SourcePill`, `HashChip`, `Card`, `Disclosure`, `Insight`, `Field`
(`components/primitives.tsx`); `Shell`, `StepBar`, `SignIn` (`components/chrome.tsx`); `PlanCard`,
`AuthorizationSeal` (`components/branch-card.tsx`); `SituationBar`, `BillsTable`, `Inbox`
(`components/books.tsx`); `DecisionPanel`, `AuthorizeDialog` (`components/inspector.tsx`);
`ActivityFeed`, `Safeguards` (`components/rail.tsx`); `Compare`, `BranchCanvas`, `RunRecord`.

Plain-language wording for steps and statuses lives in one place, `lib/describe.ts`.

## Copy

Short sentences in a CFO's words: plan, bill, approve, execute, defer. Buttons say what they do.
Errors say what failed and what happens next.
