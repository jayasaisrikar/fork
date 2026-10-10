# FORK

**Branch the decision. Govern the execution.**

FORK is an execution harness for financial AI agents, built for ArmorIQ's Flow State 2026
hackathon. A strategist agent forks a payment decision into branches, each branch is simulated
against a sandbox copy of the books, and a human signs one. An executor agent then carries out
only that branch, with every tool call checked by ArmorIQ.

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

All payments are Stripe test mode. Kettle & Pine Coffee Roasters is fictional.
