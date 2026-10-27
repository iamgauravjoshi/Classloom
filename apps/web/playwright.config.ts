import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);
// Locally the web port can be moved aside (E2E_WEB_PORT) when something else holds 3000.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

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
    baseURL: WEB_ORIGIN,
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
      // CORS and the emailed verification links must point at the E2E web server, and the public
      // throttles must not trip over the many registrations the suite makes.
      env: {
        WEB_ORIGIN,
        REGISTRATION_RATE_LIMIT_PER_HOUR: '1000',
        CODE_AVAILABILITY_RATE_LIMIT_PER_MINUTE: '10000',
      },
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      name: 'web',
      command: `node node_modules/next/dist/bin/next start -p ${WEB_PORT}`,
      url: `${WEB_ORIGIN}/en/dashboard`,
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
