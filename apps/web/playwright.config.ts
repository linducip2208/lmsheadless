import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  // Single worker: all specs share one dev API + SQLite file and cold vite
  // transforms; parallel workers starve the servers and flake timing asserts.
  workers: 1,
  use: {
    baseURL: 'http://localhost:5177',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../../node_modules/tsx/dist/cli.mjs ../api/src/dev.ts',
      port: 8787,
      reuseExistingServer: true,
      timeout: 60_000,
      // Test-only: E2E performs hundreds of legitimate calls from one IP
      // (Playwright + browser share localhost). Production defaults
      // (120/min global, 60/min auth) are unchanged in code and deployment.
      env: {
        DATABASE_PATH: '../api/.data/lms.db',
        AUTH_RATE_LIMIT_MAX: '5000',
        RATE_LIMIT_MAX: '5000',
      },
    },
    {
      command: 'npx vite --port 5177 --strictPort',
      port: 5177,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --port 5173 --strictPort',
      port: 5173,
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../admin',
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --port 5174 --strictPort',
      port: 5174,
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../student',
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --port 5175 --strictPort',
      port: 5175,
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../teacher',
    },
    {
      command: 'node ../../node_modules/vite/bin/vite.js --port 5176 --strictPort',
      port: 5176,
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../parent',
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
