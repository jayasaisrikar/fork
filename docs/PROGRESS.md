# Progress

## Phase 0 — Setup (2026-10-10)

**Built**

- pnpm workspace: `apps/web`, `apps/engine`, `mcp/treasury-mcp`, `mcp/payments-mcp`,
  `packages/shared`, `packages/sim`.
- Root tooling: TypeScript, ESLint (flat config), Prettier, Vitest.
- `apps/web`: Next.js App Router skeleton with the Part 7.2 color tokens and the three fonts wired
  through `next/font`.
- `apps/engine`: Hono server with `/health`.
- `.env.example`, `armoriq/policy.fork-executor.yaml` (spec starting point, unmodified).

**Definition of done**

- [x] `pnpm build` passes on the empty apps.
- [x] `pnpm lint` and `pnpm format:check` pass.
- [x] Env documented in `.env.example`.
- [ ] HUMAN TASK: ArmorIQ account, API key, agent `fork-executor` registered.
- [ ] HUMAN TASK: Stripe account in test mode with Connect enabled.

**Pinned versions** (newest release published on or before 2026-09-26)

| Package                   | Version | Package                   | Version |
| ------------------------- | ------- | ------------------------- | ------- |
| next / eslint-config-next | 16.3.6  | react / react-dom         | 19.3.0  |
| tailwindcss / postcss     | 4.3.3   | @xyflow/react             | 12.12.0 |
| recharts                  | 3.10.1  | motion                    | 13.4.4  |
| sonner                    | 2.0.8   | cmdk                      | 1.1.1   |
| lucide-react              | 1.48.0  | hono                      | 4.13.9  |
| @hono/node-server         | 2.1.1   | zod                       | 4.6.5   |
| ai                        | 7.0.116 | @ai-sdk/openai-compatible | 3.0.57  |
| @modelcontextprotocol/sdk | 1.30.1  | @armoriq/sdk              | 0.6.10  |
| stripe                    | 22.6.2  | typescript                | 6.0.3   |
| vitest                    | 5.0.2   | tsx                       | 4.23.15 |
| eslint                    | 10.11.0 | typescript-eslint         | 8.70.1  |
| prettier                  | 3.9.9   | @types/node               | 26.6.3  |

Chosen but not installed until the phase that uses them: `better-sqlite3` 13.0.3,
`drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11, `@types/better-sqlite3` 9.6.0 (Phase 2/3),
`stripe` 22.6.2 (Phase 1/2), `@playwright/test` 1.63.0, `@axe-core/playwright` 4.13.0 (Phase 4).

**Changes from the spec, and why**

- **Node 22.12+ instead of Node 20+.** `ai` 7 and `@ai-sdk/openai-compatible` 3 require Node >= 22;
  Vitest 5 requires `^22.12 || ^24 || >=26`. `.nvmrc` pins 24. Node 25 is not supported by Vitest 5.
- **TypeScript 6.0.3, not 7.0.2.** `typescript-eslint` 8.70 supports `typescript <6.1.0`.
- **14-day rule is enforced by pnpm**, not only by hand: `minimumReleaseAge: 20160` in
  `pnpm-workspace.yaml` applies it to transitive dependencies too.
- **Workspace packages export TypeScript source** (`exports: ./src/index.ts`); `build` for
  non-web workspaces is `tsc --noEmit`. The engine and MCP servers run with `tsx`, and Next
  compiles `@fork/shared` through `transpilePackages`. Simpler than per-package emit and
  watch; nothing is published.
- **No `eslint-config-next`.** Root ESLint uses `@eslint/js` + `typescript-eslint` only, to keep one
  config for the whole repo.
- `FORK_BUILD_SPEC.md` is not in the repo yet (it was pasted into the session, not saved as a file).
