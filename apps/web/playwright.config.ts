import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
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
      env: { DATABASE_PATH: '../api/.data/lms.db' },
    },
    {
      command: 'npx vite --port 5177 --strictPort',
      port: 5177,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
