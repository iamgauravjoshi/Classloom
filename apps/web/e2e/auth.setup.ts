import { expect, test as setup } from '@playwright/test';

import { createVerifiedSchool, signInWithCode } from './support/school';

/** Shared by every device project (see `playwright.config.ts`); git-ignored. */
const OWNER_STATE = 'e2e/.auth/owner.json';

// Signs in once, through the real code flow, and saves the browser state the device projects
// reuse. There is no test-only API endpoint; the sign-in pages arrive later, so this uses the API.
setup('sign in as a school owner', async ({ page }) => {
  const school = await createVerifiedSchool(page.request);
  await signInWithCode(page.request, school);

  await page.goto('/en/dashboard');
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.context().storageState({ path: OWNER_STATE });
});
