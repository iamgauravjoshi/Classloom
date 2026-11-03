import { defineConfig, devices } from '@playwright/test';

// Written by the auth-setup project (e2e/auth.setup.ts); git-ignored.
const OWNER_STATE = 'e2e/.auth/owner.json';

const CI = Boolean(process.env.CI);
// Locally the web port can be moved aside (E2E_WEB_PORT) when something else holds 3000.
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3000);
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
// The API port can be moved aside too (E2E_API_PORT) when a dev server holds 4000. The web server
// reaches the API through the `/api` rewrite, whose target (`API_INTERNAL_URL`) is fixed at BUILD
// time: when you change this port, build with `API_INTERNAL_URL=http://localhost:<E2E_API_PORT>`
// (`pnpm --filter @classloom/web build`: Turborepo's strict env mode hides it from `pnpm build`).
const API_PORT = Number(process.env.E2E_API_PORT ?? 4000);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  // Fail fast instead of hanging a CI runner: the whole suite takes about 22 minutes on two workers.
  globalTimeout: CI ? 40 * 60_000 : undefined,
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
      url: `http://localhost:${API_PORT}/health`,
      // CORS and the emailed verification links must point at the E2E web server, and the public
      // throttles must not trip over the many registrations the suite makes.
      env: {
        API_PORT: String(API_PORT),
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
      url: `${WEB_ORIGIN}/en/sign-in`,
      // Server-side session reads go to the same API (the rewrite target was fixed at build time).
      env: { API_INTERNAL_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: !CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
