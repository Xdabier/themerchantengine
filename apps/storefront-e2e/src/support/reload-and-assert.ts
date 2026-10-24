import type { Page } from '@playwright/test';
import type { AssertCleanOptions, ConsoleBaseline } from './console-baseline';

/**
 * Post-mutation reload helper for storefront Playwright specs.
 *
 * After every create / update / delete / approve / answer the spec MUST
 * exercise the seam between the mutation and the next page load. The
 * 2026-05-14 `questionRows` regression lived entirely in that seam:
 * within-flow assertions passed, but reloading the product page after
 * approving + answering a question crashed because the refetch payload
 * shape differed from the seed payload shape. See
 * `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B.
 *
 * `reloadAndAssertClean` navigates the page to an intermediate route
 * (defaults to `/`), waits for the network to settle, then returns to the
 * original route and re-asserts the console baseline. The
 * `storefront-reload-resilience-auditor` agent enforces presence on every
 * mutation journey at phase exit.
 *
 * Usage:
 *
 *   test('approve question survives reload', async ({ page }) => {
 *     const baseline = attachConsoleBaseline(page);
 *     // ... drive the mutation through the UI / API ...
 *     await reloadAndAssertClean(page, `/en/catalog/product/${slug}`, baseline);
 *     baseline.assertClean();
 *   });
 */
export interface ReloadAndAssertOptions {
  /**
   * Route to visit between leaving and returning to the target page.
   * Defaults to `/` so the SSR shell fully unmounts before the reload.
   */
  intermediateRoute?: string;
  /**
   * Extra hook the caller can run after the return navigation completes
   * (e.g. asserting a specific element re-rendered with the persisted
   * mutation). Runs BEFORE the baseline-clean assertion so any thrown
   * error surfaces first.
   */
  afterReload?: () => Promise<void> | void;
  /**
   * Console-error patterns the caller has already accounted for, forwarded to
   * `assertClean`. Needed by journeys whose mutation is a deliberate failure:
   * the baseline still holds that entry when the reload re-asserts it.
   */
  ignore?: AssertCleanOptions['ignore'];
}

export async function reloadAndAssertClean(
  page: Page,
  route: string,
  baseline: ConsoleBaseline,
  options: ReloadAndAssertOptions = {},
): Promise<void> {
  const intermediate = options.intermediateRoute ?? '/';

  // WebKit reports a boot fetch cancelled by navigation as a pageerror, so
  // each page settles before the helper leaves it.
  await page.waitForLoadState('networkidle');
  await page.goto(intermediate);
  await page.waitForLoadState('networkidle');

  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');

  if (options.afterReload) {
    await options.afterReload();
  }

  baseline.assertClean(options.ignore ? { ignore: options.ignore } : undefined);
}
