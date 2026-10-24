import { test } from './_auth-fixture';
import { expectRoute } from './_helpers';

test('settings home renders', async ({ page }) => {
  await expectRoute(page, '/settings', 'settings-home-page');
});

test('settings general renders', async ({ page }) => {
  await expectRoute(page, '/settings/general', 'settings-general-page');
});

test('settings locales renders', async ({ page }) => {
  await expectRoute(page, '/settings/locales', 'settings-locales-page');
});

test('settings appearance renders', async ({ page }) => {
  await expectRoute(page, '/settings/appearance', 'settings-appearance-page');
});

test('settings integrations renders', async ({ page }) => {
  await expectRoute(page, '/settings/integrations', 'settings-integrations-page');
});
