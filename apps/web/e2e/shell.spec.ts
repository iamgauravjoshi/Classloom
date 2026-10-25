import { expect, type Page, test } from '@playwright/test';

/** Viewports narrower than Tailwind's lg show the sidebar as an off-canvas sheet. */
const isSheetLayout = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Opens the dashboard and waits for hydration: "API online" only appears once the client has fetched. */
async function openDashboard(page: Page) {
  await page.goto('/en/dashboard');
  await expect(page.getByText('API online')).toBeVisible();
}

const sidebarTrigger = (page: Page) =>
  page.getByRole('button', { name: 'Toggle sidebar', exact: true });

test('root redirects to the dashboard, which reports the API online', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('API online')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
});

test('pages never scroll horizontally', async ({ page }) => {
  for (const path of ['/en/dashboard', '/en/school-profile']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noHorizontalOverflow(page), path).toBe(true);
  }
});

test('navigation is reachable and leads to module placeholders', async ({ page }) => {
  await openDashboard(page);
  if (isSheetLayout(page)) await sidebarTrigger(page).click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Students' }).click();
  await expect(page).toHaveURL(/\/en\/students$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Students' })).toBeVisible();
  await expect(page.getByText('Students is coming soon')).toBeVisible();
});

test('the sidebar collapses to icons on desktop', async ({ page }) => {
  test.skip(isSheetLayout(page), 'Sheet layout below lg');
  await openDashboard(page);
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  await expect(sidebar).toHaveAttribute('data-state', 'expanded');
  await sidebarTrigger(page).click();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
});

test('Ctrl+K opens page search', async ({ page }) => {
  test.skip(isSheetLayout(page), 'Keyboard shortcut is a desktop affordance');
  await openDashboard(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search Classloom' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill('Fees');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/en\/fees$/);
});

test('the search button opens page search on every device', async ({ page }) => {
  await openDashboard(page);
  await page.getByRole('button', { name: 'Search pages…' }).click();
  await expect(page.getByRole('dialog', { name: 'Search Classloom' })).toBeVisible();
});

test('the chosen theme persists across reloads', async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('unknown pages show the localized 404', async ({ page }) => {
  for (const path of ['/en/definitely-missing', '/en/students/unknown/deeper']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});

test('the PWA manifest is served', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { name: string; icons: { src: string }[] };
  expect(manifest.name).toBe('Classloom');
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.headers()['content-type'], icon.src).toBe('image/png');
  }
});
