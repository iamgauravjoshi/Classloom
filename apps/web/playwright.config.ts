import { defineConfig, devices } from '@playwright/test';

// Written by the auth-setup project (e2e/auth.setup.ts); git-ignored.
const OWNER_STATE = 'e2e/.auth/owner.json';

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
    // Signs in once through the real code flow; the device projects reuse the saved state.
    { name: 'auth-setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop-chrome',
      dependencies: ['auth-setup'],
      use: { ...devices['Desktop Chrome'], storageState: OWNER_STATE },
    },
    {
      name: 'desktop-firefox',
      dependencies: ['auth-setup'],
      use: { ...devices['Desktop Firefox'], storageState: OWNER_STATE },
    },
    {
      name: 'desktop-webkit',
      dependencies: ['auth-setup'],
      use: { ...devices['Desktop Safari'], storageState: OWNER_STATE },
    },
    {
      name: 'pixel-7',
      dependencies: ['auth-setup'],
      use: { ...devices['Pixel 7'], storageState: OWNER_STATE },
    },
    {
      name: 'iphone-14',
      dependencies: ['auth-setup'],
      use: { ...devices['iPhone 14'], storageState: OWNER_STATE },
    },
    {
      name: 'ipad',
      dependencies: ['auth-setup'],
      use: { ...devices['iPad (gen 7)'], storageState: OWNER_STATE },
    },
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
        RESEND_RATE_LIMIT_PER_HOUR: '1000',
        SIGN_IN_RATE_LIMIT_PER_15_MIN: '10000',
        CODE_REQUEST_RATE_LIMIT_PER_HOUR: '10000',
        PASSWORD_RESET_RATE_LIMIT_PER_HOUR: '10000',
      },
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      name: 'web',
      command: `node node_modules/next/dist/bin/next start -p ${WEB_PORT}`,
      // A public page: protected ones redirect to sign-in without a session.
      url: `${WEB_ORIGIN}/en/register-school`,
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
