# FORK

**Explore every outcome. Commit only one.**

FORK is a branch-and-commit execution harness for AI agents, built for ArmorIQ's Flow State 2026
hackathon. A planner agent proposes branches, FORK simulates each one against the same frozen
snapshot of the books, and a human authorizes one. A deterministic runner then commits only that
branch through an MCP server, with ArmorIQ checking every call.

Work in progress. See `docs/PROGRESS.md` for status and `docs/FINDINGS.md` for what the ArmorIQ
SDK actually does.

## Setup

Requires Node 22.12+ (`.nvmrc` pins 24) and pnpm 10.

```sh
nvm use
pnpm install
cp .env.example .env   # then fill in the values
pnpm build
```

Fictional company. Sandbox ledger. No real payments.
