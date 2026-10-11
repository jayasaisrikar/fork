# engine and payment MCP in one container, on one port. the web app deploys separately.
FROM node:24-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/engine/package.json apps/engine/
COPY apps/finance-mcp/package.json apps/finance-mcp/
COPY apps/web/package.json apps/web/
COPY packages/armor-adapter/package.json packages/armor-adapter/
COPY packages/db/package.json packages/db/
COPY packages/domain-finance/package.json packages/domain-finance/
COPY packages/domain-portfolio/package.json packages/domain-portfolio/
COPY packages/harness/package.json packages/harness/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter '!@fork/web'

COPY . .

ENV NODE_ENV=production PORT=8080 DATABASE_PATH=/data/fork.db
RUN mkdir -p /data
EXPOSE 8080
CMD ["npx", "tsx", "scripts/serve.ts"]
