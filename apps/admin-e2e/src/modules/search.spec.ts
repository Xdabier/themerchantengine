import { test } from './_auth-fixture';
import { expectRoute } from './_helpers';

test('search results page renders with query', async ({ page }) => {
  // Seeded product catalogue contains a sneaker-shaped item — "s" catches
  // most fixtures without being picky about the exact name.
  await expectRoute(page, '/search?q=s', 'search-results-page');
});

test('search results page renders empty state with no query', async ({ page }) => {
  await expectRoute(page, '/search', 'search-results-page');
});
