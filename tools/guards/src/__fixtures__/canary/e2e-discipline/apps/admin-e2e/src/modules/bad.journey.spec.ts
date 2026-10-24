// Canary fixture. Never collected by Playwright.
import { test } from '@playwright/test';

test.skip('closed with a skip instead of a fix', async ({ page }) => {
  await page.route('**/v1/admin/products*', (r) => r.fulfill({ body: '[]' }));
});

test.only('exclusive test left behind', async () => {
  /* no-op */
});

test.fixme('parked under a nicer name', async () => {
  /* no-op */
});

xit('jasmine-style disable', async () => {
  /* no-op */
});

describe.skip('a whole block switched off', () => {
  /* no-op */
});
