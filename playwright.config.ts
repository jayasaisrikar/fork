import { defineConfig } from '@playwright/test';

const ENGINE_PORT = 8791;
const WEB_PORT = 3100;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, viewport: { width: 1440, height: 900 } },
  webServer: [
    {
      command: 'npx tsx tests/e2e/server.ts',
      url: `http://localhost:${ENGINE_PORT}/api/health`,
      reuseExistingServer: false,
      env: { E2E_ENGINE_PORT: String(ENGINE_PORT), E2E_WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
    },
    {
      command: `npx next dev -p ${WEB_PORT}`,
      cwd: 'apps/web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_ENGINE_URL: `http://localhost:${ENGINE_PORT}`,
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
});
