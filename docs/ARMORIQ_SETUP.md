# ArmorIQ setup

What it takes to point FORK at your own ArmorIQ workspace. Written from what the platform actually
did in October 2026, which differs from its docs in places.

## 1. API key

On platform.armoriq.ai, create an API key and put it in `.env` as `ARMORIQ_API_KEY`. Keys start
with `ak_live_` or `ak_test_`.

Set `CFO_EMAIL` to the email you log in to ArmorIQ with. That is the account that approves holds.

## 2. Make the MCP reachable over HTTPS

ArmorIQ's proxy calls the MCP, so it needs a public HTTPS URL.

Locally:

```sh
pnpm dev:mcp
touch /tmp/empty-cloudflared.yml
cloudflared tunnel --config /tmp/empty-cloudflared.yml --url http://127.0.0.1:8797
```

The empty config matters if you have a `~/.cloudflared/config.yml`: without it a quick tunnel picks
up that file's routing rules and answers 404.

Hosted: run `pnpm serve` (engine and MCP on one port) behind HTTPS and use `https://<host>/mcp`.
See [DEPLOY.md](DEPLOY.md).

## 3. Register the MCP

MCP Registry, Add MCP:

- **Name:** `fork-finance-mcp`. It must match exactly. If you register under another name, set
  `FORK_MCP_NAME` to it for the engine (the hosted demo uses `forkfinance-mcp`).
- **URL:** `https://<host>/mcp`
- **Authentication:** API key. The value is your `FORK_MCP_KEY`.

The form sends the key as `X-API-Key` and cannot be given another header name. The MCP accepts the
key in `X-Fork-MCP-Key`, `X-API-Key` or `Authorization: Bearer`.

The Inventory page's tool list can be stale. To see what ArmorIQ really knows, open the health
popover in FORK's workspace: it lists the registered tools from the API. There should be eight.

## 4. Policy

Policies, New policy. Target **An MCP Server** and pick the MCP you registered. Open the **YAML** tab
and paste [`armoriq/policy.fork.yaml`](../armoriq/policy.fork.yaml), replacing the `target` id with
your MCP's id (it is shown in the editor). Then **Activate**. A draft enforces nothing.

The policy allows the read tools and `execute_payment`, holds `execute_large_payment`, blocks
`update_vendor_destination`, and blocks anything unlisted.

If the editor says the server "did not return a tool list", ignore it and paste the YAML anyway.

## 5. Check it

```sh
pnpm spike S0 S1 S2 S5
```

S1 should resolve, S2 should give `IntentMismatchException`, S5 should give
`PolicyBlockedException`.

## 6. Approving a hold

When a payment over $10,000 is held, FORK shows a card with the delegation id. On the platform go
to **Intent, Held Actions** and approve the newest request for `execute_large_payment`. FORK polls
and carries on. The window is `HOLD_TIMEOUT_MS` (three minutes by default).

ArmorIQ will not let the requester approve their own request. FORK files the request as
`ARMORIQ_REQUESTER_EMAIL`, which must be different from the account that approves.

## 7. Where the evidence is

**Intent** lists every plan with its outcome. A blocked call shows the plan as Blocked by Policy
Engine. The plan detail page shows the root hash, which matches the plan hash FORK stores.
Plans created before a policy was activated all show as Blocked, so take proof screenshots from a
fresh run.

## Things that did not work

- **Registering an agent.** The Add AI agent form failed with "url must be a URL address" on every
  method. FORK runs without one: the SDK needs only the API key, and the policy targets the MCP.
  Plans therefore show the agent as `__sdk_multiuser__`.
- **Amount thresholds.** The policy editor has per-tool allow, hold and block only. FORK uses a
  second tool for large payments instead.
- **The SDK's own hold wait.** It reads the payment amount from tool metadata we could not set and
  sends zero. FORK's adapter opens the approval request itself.
