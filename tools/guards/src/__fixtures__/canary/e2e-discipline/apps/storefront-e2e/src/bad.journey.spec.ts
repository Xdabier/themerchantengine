// Canary fixture. Never collected by Playwright.
import { test } from '@playwright/test';

import { signUpViaApi } from './support';

// Mutates through a session helper and a submit, with no API write anywhere:
// the shape the first version of this guard read as read-only.
test('registers an account with no hardening layer', async ({ page, request }) => {
  await signUpViaApi(request, { email: 'x@example.com' });
  await page.getByTestId('auth-register-submit').click();
});
