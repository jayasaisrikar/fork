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
- **Web app: not deployed yet.** Steps are in section 3.

## 1. Engine and MCP

Any host that can run Node 24 and give you an HTTPS URL works. Keep it to one process: two would
each hold intent tokens the other cannot see.

```sh
git clone <repo> /opt/fork && cd /opt/fork
pnpm install --frozen-lockfile --filter '!@fork/web'
cp .env.example .env    # fill it in, see below
PORT=8790 pnpm serve
```

| Variable                                                              | Value                                         |
| --------------------------------------------------------------------- | --------------------------------------------- |
| `ARMORIQ_API_KEY`                                                     | Your ArmorIQ key                              |
| `CFO_EMAIL`                                                           | Your ArmorIQ login email                      |
| `CFO_PASSWORD`                                                        | A password for the demo CFO                   |
| `ARMORIQ_REQUESTER_EMAIL`                                             | `fork-agent@kettleandpine.test`               |
| `FORK_MCP_KEY`                                                        | Same value as registered on ArmorIQ           |
| `FORK_MCP_NAME`                                                       | Only if not registered as `fork-finance-mcp`  |
| `MCP_CAPABILITY_SECRET`                                               | `openssl rand -hex 32`                        |
| `DEMO_ADMIN_KEY`                                                      | `openssl rand -hex 24`                        |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_PLANNER`, `LLM_MODEL_INBOX` | Your model provider                           |
| `WEB_ORIGIN`                                                          | The web app's URL, once you have it           |
| `NODE_ENV`, `DATABASE_PATH`                                           | `production`, and where the ledger file lives |

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

   | Variable               | Value                         |
   | ---------------------- | ----------------------------- |
   | `ENGINE_PROXY_URL`     | The engine's public HTTPS URL |
   | `NEXT_PUBLIC_REPO_URL` | The repository URL            |

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

## Not verified

- The Vercel deploy and the proxy on Vercel. The proxy was tested locally for requests and the
  event stream.
- The Docker image and the Railway path.
