# Design system

FORK should read as financial infrastructure with a git client's soul: dense like a terminal,
disciplined like a bank statement, with the branch graph as the one loud thing.

## Color

Defined as CSS variables in `apps/web/app/globals.css`. Components use the tokens, never a hex.

| Token           | Dark      | Light     | Use                                      |
| --------------- | --------- | --------- | ---------------------------------------- |
| `--bg`          | `#0B0E0D` | `#F4F5F3` | Page                                     |
| `--surface`     | `#121614` | `#FFFFFF` | Panels                                   |
| `--raised`      | `#191E1C` | `#ECEEEB` | Hover, selected row                      |
| `--line`        | `#252C29` | `#D8DCD8` | Borders, grid                            |
| `--text`        | `#E4EAE7` | `#121614` | Body                                     |
| `--muted`       | `#8A9590` | `#58625D` | Labels                                   |
| `--accent`      | `#3BBFAE` | `#0E6E64` | Selection, the authorization seal, focus |
| `--sim`         | `#8FA3C8` | `#46598A` | Simulated, uncommitted edges             |
| `--allow`       | `#46C487` | `#167A47` | ALLOW                                    |
| `--hold`        | `#E3A93A` | `#9A6200` | HOLD                                     |
| `--block`       | `#EF6A55` | `#B8301C` | BLOCK, and negative money                |
| `--fork-reject` | `#C9A0DC` | `#6B3F86` | FORK's and the MCP's own refusals        |
| `--unknown`     | `#8A9590` | `#58625D` | Errors                                   |

Rules:

- **Authorize is accent. Allow is green.** A decision is not an enforcement outcome.
- Verdict colors appear only on verdict pills, graph dead ends, step dots and their rows.
- A refusal that did not come from ArmorIQ never wears an ArmorIQ verdict color.
- Status always has a text label. Color is never the only signal.
- No gradients. The "Rejected by FORK" hatch is hard-edged stripes.

The workspace is dark-first. The landing page, run record and audit page are light-first. Every
page has both themes.

## Type

| Role        | Face                           | Where                                      |
| ----------- | ------------------------------ | ------------------------------------------ |
| UI and body | IBM Plex Sans 400, 500, 600    | Everything by default                      |
| Data        | IBM Plex Mono, tabular figures | Money, ids, hashes, timestamps, tool names |
| Display     | Archivo 800, wide              | Landing headlines and the wordmark         |

Sizes in px: 11, 12, 13, 14, 16, 20, 28, 40, and 64 to 80 for the landing headline.
Labels are 11px uppercase with 0.08em tracking, in `--muted`.
Money is mono and right-aligned in tables. Hashes show the first six and last four characters, with
copy on click and the full value in a tooltip.

## Shape and layout

- 4px spacing base. Radius 6px on panels, 4px on inputs and pills, none on table rows.
- Borders separate things. The only shadows are on popovers and dialogs.
- Workspace: 56px top bar, no sidebar. Books 288px, inspector 360px, graph in between, rail below.
- Under 1280px the side panels become tabs. Under 768px a list replaces the graph and the primary
  action sits in a bar at the bottom.

## Components

`BranchCard`, `AuthorizationSeal`, `VerdictPill`, `SourcePill`, `HashChip`, `Money`
(`components/primitives.tsx`, `components/branch-card.tsx`), the graph nodes and edges
(`components/branch-canvas.tsx`), `ExecutionRail`, `Compare`, `Inspector`, `RunRecord`.

Dialogs, tabs, tooltips and popovers are Radix primitives styled to the tokens.

## Motion

Only these, 150 to 400ms, ease-out: the seal drawing in, step dots filling, rail rows sliding in,
the verdict notifier. Under `prefers-reduced-motion` they become opacity changes or nothing.

## Copy

Short sentences in a CFO's words: invoice, payment, authorize, defer. Buttons say what they do.
Errors say what failed and what happens next. A disabled control always says why.
