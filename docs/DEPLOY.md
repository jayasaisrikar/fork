# Deploying

Two parts: the engine with the payment MCP as one process, and the web app on Vercel. The engine
and MCP share one SQLite file, so they run together on one port (`scripts/serve.ts`): the engine at
`/api`, the MCP at `/mcp`, and `/health`.

## What is running now

- **Engine and MCP: hosted.** One systemd service on a small shared Linux VM, bound to localhost
  and published over HTTPS with Tailscale Funnel. `/api/health` reports ArmorIQ configured and
  reachable with eight registered tools, and the live suite passed there (5 of 5).
- **ArmorIQ points at it.** The MCP is registered as `forkfinance-mcp` and the `fork-treasury`
  policy targets that registration, so the service runs with `FORK_MCP_NAME=forkfinance-mcp`.
- **Web app: deployed** at `https://fork-dun.vercel.app`, proxying `/api` to the engine.
- **Proof Mode is live.** `proof-mode` was merged into `main` at `2b565ca` and rolled out to both
  on 2026-10-12, with `PROOF_EDGE_KEY` set on the engine and on Vercel (Production). Checked the
  same day through the Vercel URL with nobody signed in: `/proof` loads, `GET /api/runs` answers
  401, a probe from the page answers 200, and a probe sent straight to the engine answers 403.
  Results and plan ids are in [TEST_EVIDENCE.md](TEST_EVIDENCE.md).

## 1. Engine and MCP

Any host that can run Node 24 and give you an HTTPS URL works. Keep it to one process: two would
each hold intent tokens the other cannot see.

```sh
git clone <repo> /opt/fork && cd /opt/fork
pnpm install --frozen-lockfile --filter '!@fork/web'
cp .env.example .env    # fill it in, see below
PORT=8790 pnpm serve
```

| Variable                                                              | Value                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ARMORIQ_API_KEY`                                                     | Your ArmorIQ key                                                           |
| `CFO_EMAIL`                                                           | Your ArmorIQ login email                                                   |
| `CFO_PASSWORD`                                                        | A password for the demo CFO                                                |
| `ARMORIQ_REQUESTER_EMAIL`                                             | `fork-agent@kettleandpine.test`                                            |
| `FORK_MCP_KEY`                                                        | Same value as registered on ArmorIQ                                        |
| `FORK_MCP_NAME`                                                       | Only if not registered as `fork-finance-mcp`                               |
| `MCP_CAPABILITY_SECRET`                                               | `openssl rand -hex 32`                                                     |
| `DEMO_ADMIN_KEY`                                                      | `openssl rand -hex 24`                                                     |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_PLANNER`, `LLM_MODEL_INBOX` | Your model provider                                                        |
| `WEB_ORIGIN`                                                          | The web app's URL, once you have it                                        |
| `NODE_ENV`, `DATABASE_PATH`                                           | `production`, and where the ledger file lives                              |
| `PROOF_COOLDOWN_SECONDS`, `PROOF_DAILY_LIMIT`                         | Optional. Shared limits on the public `/proof` probes (default 20 and 200) |
| `PROOF_EDGE_KEY`                                                      | `openssl rand -hex 24`. The same value as on Vercel. See section 5         |
| `PROOF_CLIENT_HOURLY_LIMIT`                                           | Optional. One visitor's probes per hour (default 10)                       |

Run it under a process manager (the hosted copy is a systemd unit with a memory cap) and put HTTPS
in front. Check `https://<host>/health` answers `{"ok":true,...}` and `/api/health` shows
`armoriqConfigured: true`.

To update: pull, reinstall with the same filter, restart. To reset the ledger: stop the service,
`pnpm reset`, start it again.

### Railway instead

`railway.json` and the `Dockerfile` build the same single-port server, with
`DATABASE_PATH=/data/fork.db` (add a volume at `/data` to keep the ledger across deploys). **This
path is not verified**: the image has never been built, because Docker was not available on the
development machine.

## 2. Point ArmorIQ at it

On platform.armoriq.ai, set the MCP's URL to `https://<host>/mcp`. The policy targets the MCP by
id, so it carries over. Then, from your machine with `.env` unchanged:

```sh
pnpm spike S1 S5
```

S1 should resolve and S5 should be blocked. Both now go through the hosted MCP.

## 3. Web on Vercel

1. New Project, import the repository, set **Root Directory** to `apps/web`.
2. Environment variables:

   | Variable               | Value                           |
   | ---------------------- | ------------------------------- |
   | `ENGINE_PROXY_URL`     | The engine's public HTTPS URL   |
   | `NEXT_PUBLIC_REPO_URL` | The repository URL              |
   | `PROOF_EDGE_KEY`       | The same value as on the engine |

3. Deploy, then set `WEB_ORIGIN` on the engine to the Vercel URL and restart it.

With `ENGINE_PROXY_URL` set, the browser calls `/api` on the web app's own domain and Vercel
forwards it to the engine. The session cookie stays first-party, which matters because browsers
block third-party cookies. The live event stream goes through the same proxy; if it is cut, the
page reconnects and resumes from the last event it saw.

`/app/lab`, `/how` and the landing page need no engine at all.

## 4. After deploying

- Sign in at `https://<web>/app` and run a branch through to a hold. Approve it on ArmorIQ.
- Run the live suite against the host:
  `ENGINE_URL=https://<host> RUN_ARMORIQ_LIVE_TESTS=1 pnpm test:live`
  with `CFO_EMAIL`, `CFO_PASSWORD` and `DEMO_ADMIN_KEY` matching the host's values.

## 5. Rolling out Proof Mode

The engine is reachable two ways: through the web app's proxy, and directly at its public URL,
which ArmorIQ needs for `/mcp`. Anyone can call it directly and type any header, so the engine
takes a visitor's address only from the web app, proven by a key the two share.

1. Generate one key, `openssl rand -hex 24`, and set it as `PROOF_EDGE_KEY` on the engine and on
   Vercel.
2. Engine: pull `proof-mode`, reinstall with the same filter, restart. Migrations `0004` and `0005`
   and the `proof-sandbox` seed apply on boot. The CFO's ledger is not reset or touched.
3. Vercel: deploy `proof-mode`. `apps/web/proxy.ts` stamps each probe with the key and the
   address Vercel saw (`x-real-ip`, which Vercel sets itself and a browser cannot override).
4. Check, with nobody signed in: `/proof` loads, `GET /api/runs` answers 401, a probe from the page
   answers 200, and `POST <engine>/api/proof/run` called directly answers 403 `EDGE_ONLY`.
5. Run the two live cases with spacing for the cooldown already built in:
   `ENGINE_URL=https://<host> RUN_ARMORIQ_LIVE_TESTS=1 PROOF_EDGE_KEY=<key> pnpm test:live -t "live proof mode"`.
   They need no CFO login and no fresh ledger. Do not run the older `live ArmorIQ` cases against a
   ledger you want to keep: they pay real sandbox invoices and expect $50,000 in cash.

What each limit does: one visitor gets `PROOF_CLIENT_HOURLY_LIMIT` probes an hour; all visitors
together are held to one probe per `PROOF_COOLDOWN_SECONDS` and `PROOF_DAILY_LIMIT` a day (UTC).
Without `PROOF_EDGE_KEY` the per-visitor limit is off and only the shared limits apply, which is
how local development and the tests run.

If `/proof` ever reports that Proof Mode is switched off, a probe left a ledger posting behind.
Find out why first, then clear it: `POST /api/demo/proof-reset` with the `x-admin-key` header.

## Not verified

- The per-visitor limit on Vercel. Probes through Vercel are accepted by the engine, which proves
  the key is forwarded. That the eleventh probe from one visitor answers 429 was only run locally,
  against a production build in proxy mode, because it would spend eleven ArmorIQ plans.
- That `x-real-ip` on Vercel is the visitor's address in every case, for example behind another
  proxy the visitor controls. It is the platform's own header; this was not tested.
- `PROOF_EDGE_KEY` on Vercel Preview deployments. It is set for Production only, so a preview
  build's probes are refused by the engine.
- A per-call policy-block record on platform.armoriq.ai. The plans are there; the block is not
  shown. See [TEST_EVIDENCE.md](TEST_EVIDENCE.md).
- The Docker image and the Railway path.
