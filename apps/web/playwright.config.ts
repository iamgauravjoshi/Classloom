import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  // Fail fast instead of hanging a CI runner: the whole suite normally takes ~5 minutes.
  globalTimeout: CI ? 20 * 60_000 : undefined,
  workers: CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-14', use: { ...devices['iPhone 14'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
  ],
  // Both servers run production builds (`pnpm build` first) against the docker infrastructure.
  // They are started with `node` directly: launched through pnpm, the node child outlives
  // Playwright's kill on Linux and teardown hangs until the global timeout.
  webServer: [
    {
      name: 'api',
      command: 'node --env-file-if-exists=../../.env dist/main.js',
      cwd: '../api',
      url: 'http://localhost:4000/health',
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      name: 'web',
      command: 'node node_modules/next/dist/bin/next start -p 3000',
      url: 'http://localhost:3000/en/dashboard',
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
