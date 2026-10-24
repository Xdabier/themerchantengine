import type { Page } from '@playwright/test';

/**
 * Wait until Angular has taken over the server-rendered markup and its event
 * handlers are live.
 *
 * A `fill()` against SSR HTML sets the DOM value but not the reactive control,
 * and hydration then resets the input, so the form submits empty or not at all.
 * A click on a server-rendered link before that point runs the browser's
 * default navigation, and the Angular handler never sees it. Both failures are
 * silent and read as "the feature is broken".
 *
 * The signal is `data-app-stable` on `<html>`, set by the storefront's
 * `provideAppStableMarker` at `ApplicationRef.whenStable()`, the same moment
 * event replay hands over to Angular's listeners. Polling the DOM for `ngh`
 * and `jsaction` is not enough: on WebKit it passed while the app was still
 * unstable and a click navigated natively.
 *
 * The attribute is set on every client boot and survives client-side
 * navigation, so the wait is also safe after an in-app route change.
 */
export async function waitForHydration(page: Page, timeout = 30_000): Promise<void> {
  await page.locator('html[data-app-stable]').waitFor({ state: 'attached', timeout });
}
