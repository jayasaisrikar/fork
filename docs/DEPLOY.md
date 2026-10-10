# Deploying

Two services: the engine with the payment MCP on Railway, and the web app on Vercel. The engine
and MCP share one SQLite file, so they run as one process on one port.

## 1. Engine and MCP on Railway

Railway reads `railway.json` and builds the `Dockerfile`. The container serves the engine at `/api`
and the MCP at `/mcp`, on the port Railway provides.

1. New Project, Deploy from GitHub repo, pick this repository.
2. In the service's **Variables**, add:

   | Variable                                                              | Value                               |
   | --------------------------------------------------------------------- | ----------------------------------- |
   | `ARMORIQ_API_KEY`                                                     | Your ArmorIQ key                    |
   | `CFO_EMAIL`                                                           | Your ArmorIQ login email            |
   | `CFO_PASSWORD`                                                        | A password for the demo CFO         |
   | `ARMORIQ_REQUESTER_EMAIL`                                             | `fork-agent@kettleandpine.test`     |
   | `FORK_MCP_KEY`                                                        | Same value as registered on ArmorIQ |
   | `MCP_CAPABILITY_SECRET`                                               | `openssl rand -hex 32`              |
   | `DEMO_ADMIN_KEY`                                                      | `openssl rand -hex 24`              |
   | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_PLANNER`, `LLM_MODEL_INBOX` | Your model provider                 |
   | `WEB_ORIGIN`                                                          | The web app's URL, once you have it |

   Do not set `PORT`; Railway does. `NODE_ENV=production` and `DATABASE_PATH=/data/fork.db` are set
   in the image.

3. **Settings, Networking, Generate Domain.** That gives `https://<name>.up.railway.app`.
4. Optional: add a **Volume** mounted at `/data` so the ledger survives redeploys. Without one the
   sandbox re-seeds to $50,000 on every deploy, which is fine for a demo.
5. Check it: `https://<name>.up.railway.app/health` should answer `{"ok":true,...}` and
   `/api/health` should show `armoriqConfigured: true`.

Keep it at one replica. Two processes would each hold intent tokens the other cannot see.

## 2. Point ArmorIQ at it

On platform.armoriq.ai, edit the `fork-finance-mcp` server and change its URL from the tunnel to
`https://<name>.up.railway.app/mcp`. The policy targets the MCP by id, so it carries over.

Then check from your machine, with `.env` unchanged:

```sh
pnpm spike S1 S5
```

S1 should resolve and S5 should be blocked. Both now go through the hosted MCP.

## 3. Web on Vercel

1. New Project, import the repository, set **Root Directory** to `apps/web`.
2. Environment variables:

   | Variable               | Value                           |
   | ---------------------- | ------------------------------- |
   | `ENGINE_PROXY_URL`     | `https://<name>.up.railway.app` |
   | `NEXT_PUBLIC_REPO_URL` | The repository URL              |

3. Deploy, then set `WEB_ORIGIN` on Railway to the Vercel URL and redeploy the engine.

With `ENGINE_PROXY_URL` set, the browser calls `/api` on the web app's own domain and Vercel
forwards it to the engine. The session cookie stays first-party, which matters because browsers
block third-party cookies. The live event stream goes through the same proxy; if it is cut, the
page reconnects and resumes from the last event it saw.

## 4. After deploying

- Sign in at `https://<web>/app` and run a branch through to a hold. Approve it on ArmorIQ.
- To reset the hosted ledger: redeploy (no volume), or delete the file on the volume and restart.
- Run the live suite against the host:
  `ENGINE_URL=https://<name>.up.railway.app RUN_ARMORIQ_LIVE_TESTS=1 pnpm test:live`
  with `CFO_EMAIL`, `CFO_PASSWORD` and `DEMO_ADMIN_KEY` matching the host's values.

## Not verified

The Docker image has not been built: Docker was not running on the development machine. The same
install and start commands were run from a clean checkout and worked, and the proxy was tested
locally for both requests and the event stream. Nothing has been deployed yet.
