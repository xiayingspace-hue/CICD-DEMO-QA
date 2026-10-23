import { test, expect } from '@playwright/test';

test('home page has title and navigates to docs', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Playwright/);
  await page.getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/intro/);
});
