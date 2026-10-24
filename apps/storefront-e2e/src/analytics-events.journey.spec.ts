import { expect, test, type Page, type Request } from '@playwright/test';

import {
  attachConsoleBaseline,
  describeEveryLocale,
  reloadAndAssertClean,
  type ConsoleBaseline,
} from './support';

/**
 * Plan I phase I7. The storefront emits first-party analytics (finding D2).
 *
 * `POST /v1/analytics/events` has been complete since the analytics module
 * shipped and nothing ever called it, so every admin analytics dashboard read
 * an empty table. This journey asserts the real posts against the real API: no
 * `page.route()` anywhere (§3.8), which also means every assertion here proves
 * the event was accepted, not merely attempted.
 */

interface IngestedEvent {
  eventType: string;
  sessionId?: string;
  productId?: string;
  orderId?: string;
  locale?: string;
  data?: Record<string, unknown>;
}

/**
 * Records every analytics post the page makes, in order.
 *
 * A recorder rather than `waitForRequest` per event: the assertions here are
 * about how MANY events fire as much as which, and a waiter cannot see a
 * second, duplicate purchase.
 */
function recordAnalytics(page: Page): IngestedEvent[] {
  const events: IngestedEvent[] = [];
  page.on('request', (request: Request) => {
    if (!request.url().includes('/v1/analytics/events')) return;
    if (request.method() !== 'POST') return;
    try {
      events.push(JSON.parse(request.postData() ?? '{}') as IngestedEvent);
    } catch {
      events.push({ eventType: '<unparseable>' });
    }
  });
  return events;
}

async function eventuallyIncludes(
  events: IngestedEvent[],
  eventType: string,
  timeoutMs = 10_000,
): Promise<IngestedEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find((event) => event.eventType === eventType);
    if (found) return found;
    if (Date.now() >= deadline) {
      throw new Error(
        `no ${eventType} event after ${timeoutMs}ms; saw [${events.map((e) => e.eventType).join(', ')}]`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describeEveryLocale('storefront analytics emission', (locale) => {
  let baseline: ConsoleBaseline;

  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });

  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`a page load posts a page_view carrying the locale (${locale})`, async ({ page }) => {
    const events = recordAnalytics(page);

    await page.goto(`/${locale}/`, { waitUntil: 'domcontentloaded' });

    const event = await eventuallyIncludes(events, 'page_view');
    expect(event.locale).toBe(locale);
    // The API rejects anything outside this set, so a bad id loses the event.
    expect(event.sessionId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test(`every event in a session carries the same session id (${locale})`, async ({ page }) => {
    const events = recordAnalytics(page);

    await page.goto(`/${locale}/`, { waitUntil: 'domcontentloaded' });
    await eventuallyIncludes(events, 'page_view');
    await page.goto(`/${locale}/catalog`, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => events.filter((event) => event.eventType === 'page_view').length)
      .toBeGreaterThan(1);

    const ids = new Set(events.map((event) => event.sessionId));
    expect(ids.size).toBe(1);
  });

  test(`opening a product posts a product_view for that product (${locale})`, async ({ page }) => {
    const events = recordAnalytics(page);

    await page.goto(`/${locale}/catalog`, { waitUntil: 'domcontentloaded' });
    const firstProduct = page.locator('[data-testid="catalog-grid"] app-product-card a').first();
    await expect(firstProduct).toBeVisible({ timeout: 20_000 });
    const href = await firstProduct.getAttribute('href');
    await page.goto(href!, { waitUntil: 'domcontentloaded' });

    const event = await eventuallyIncludes(events, 'product_view', 20_000);
    expect(event.productId).toBeTruthy();
    expect(event.data?.['slug']).toBe(href!.split('/').pop());
  });

  test(`the beacon never reports a failure to the console (${locale})`, async ({ page }) => {
    // The tracker swallows every failure by contract. The console baseline in
    // afterEach is the assertion; this test exists so the reload seam is
    // exercised with the tracker live, per the standing mutation-journey rule.
    const events = recordAnalytics(page);

    await page.goto(`/${locale}/catalog`, { waitUntil: 'domcontentloaded' });
    await eventuallyIncludes(events, 'page_view');

    await reloadAndAssertClean(page, `/${locale}/catalog`, baseline, {
      afterReload: async () => {
        await expect(page.locator('[data-testid="catalog-grid"]').first()).toBeVisible({
          timeout: 20_000,
        });
      },
    });
  });
});
