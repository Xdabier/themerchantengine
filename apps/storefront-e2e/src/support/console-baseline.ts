import type { ConsoleMessage, Page } from '@playwright/test';

/**
 * Console + uncaught-error baseline for storefront Playwright specs.
 *
 * Wires `page.on('pageerror', ...)` and `page.on('console', ...)` so any
 * uncaught exception or `console.error` that fires during a test surfaces
 * as a hard assertion failure at teardown. Without this, a `TypeError`
 * inside an Angular `computed()` renders the section empty but never
 * fails an assertion — the suite stays green while production surfaces
 * the bug to the user. The 2026-05-14 `questionRows` regression on
 * https://the storefront is exactly that shape; this helper closes it.
 *
 * Usage:
 *
 *   import { attachConsoleBaseline } from './support/console-baseline';
 *
 *   test.describe('my journey', () => {
 *     let baseline: ConsoleBaseline;
 *     test.beforeEach(({ page }) => {
 *       baseline = attachConsoleBaseline(page);
 *     });
 *     test.afterEach(() => {
 *       baseline.assertClean();
 *     });
 *     ...
 *   });
 *
 * Per `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B this
 * helper is MANDATORY on every `.journey.spec.ts`. The
 * `storefront-console-error-guard-auditor` agent enforces presence at
 * phase exit.
 */
export interface ConsoleBaselineEntry {
  kind: 'pageerror' | 'console.error';
  message: string;
  stack?: string;
  /**
   * The resource the browser was complaining about, when it named one.
   *
   * Carried so an allow-list can be scoped to a specific resource instead of
   * to a message substring. "Failed to load resource: the server responded
   * with a status of 404" is emitted for a missing image, a failed API call
   * and a document that answered 404 alike, so a RegExp on the text would
   * hide all three. With the URL in hand a predicate can ignore exactly the
   * one the test asked for.
   */
  url?: string;
}

/**
 * Allow-list contract for `assertClean`. Specs that intentionally provoke
 * error states (e.g. `error-pages.journey.spec.ts`) pass an `ignore` array
 * of predicates — every captured entry that matches ANY predicate is
 * filtered out before the throw. Predicates are either RegExp (tested
 * against the message string) or a custom function (full entry view).
 *
 * Allow-list usage MUST cite the specific known-noise pattern in a comment
 * next to the call. Silent broadening of the allow-list is a regression
 * vector — the next bug of the same shape would also slip through.
 */
export interface AssertCleanOptions {
  ignore?: Array<RegExp | ((entry: ConsoleBaselineEntry) => boolean)>;
}

export interface ConsoleBaseline {
  /**
   * Throws an `Error` with a punch-list of every captured entry if any
   * pageerror or console.error fired since attach time. Call from
   * `afterEach`; never silently swallow.
   *
   * Pass `{ ignore }` to filter out known-noise entries — intentional-error
   * specs only. Document every ignore pattern with a comment that cites
   * the exact framework or test path that produces it.
   */
  assertClean(options?: AssertCleanOptions): void;
  /**
   * Clears all accumulated entries. Use only when a test has already made
   * an explicit in-test assertion about the expected error entries (e.g.
   * checking that a 429 did NOT cause a logout) and needs to drain them
   * before the outer `afterEach` `assertClean()` fires. Document the reason
   * at every call site — silent use is a regression vector.
   */
  reset(): void;
  /**
   * Read-only view of captured entries. Useful for tests that want to
   * inspect a specific known-warn (whitelist) before calling assertClean.
   */
  readonly entries: ReadonlyArray<ConsoleBaselineEntry>;
}

/**
 * Ignore the browser's own log line for a document that deliberately answered
 * 404, and nothing else.
 *
 * A page asked for on purpose because it does not exist still logs "Failed to
 * load resource: the server responded with a status of 404". That is the
 * browser reporting the status the test is asserting, not an application
 * error, and it appeared the moment the storefront started answering a real
 * 404 on unknown slugs instead of a 200 with an empty body.
 *
 * Deliberately not a RegExp on the message: the same text is emitted for a
 * missing image or a failed API call, and a substring rule would hide those
 * too. This matches only when the resource the browser named is the document
 * the test navigated to, so a 404 on anything else still fails the run.
 *
 * Pass the page so the URL is read at assertion time, after any redirect.
 */
export function expectedDocumentNotFound(page: Page) {
  return (entry: ConsoleBaselineEntry): boolean =>
    entry.kind === 'console.error' &&
    /status of 404/.test(entry.message) &&
    entry.url === page.url();
}

export function attachConsoleBaseline(page: Page): ConsoleBaseline {
  const entries: ConsoleBaselineEntry[] = [];

  page.on('pageerror', (err: Error) => {
    entries.push({ kind: 'pageerror', message: err.message, stack: err.stack });
  });

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      entries.push({
        kind: 'console.error',
        message: msg.text(),
        url: msg.location()?.url || undefined,
      });
    }
  });

  return {
    get entries() {
      return entries;
    },
    reset() {
      entries.length = 0;
    },
    assertClean(options: AssertCleanOptions = {}) {
      const ignore = options.ignore ?? [];
      const blocking = entries.filter(
        (entry) =>
          !ignore.some((rule) => (rule instanceof RegExp ? rule.test(entry.message) : rule(entry))),
      );
      if (blocking.length === 0) return;
      const summary = blocking
        .map(
          (e, i) =>
            `  [${i + 1}] ${e.kind}: ${e.message}${e.url ? `\n      at ${e.url}` : ''}${e.stack ? `\n      ${e.stack.split('\n').join('\n      ')}` : ''}`,
        )
        .join('\n');
      throw new Error(
        `Page emitted ${blocking.length} unexpected console error / pageerror entries:\n${summary}\n` +
          `Storefront tests must stay clean per specs/features/storefront-e2e-hardening/plan.md §4.2 Layer B. ` +
          `Allow-list intentional-error patterns via assertClean({ ignore: [<RegExp>] }) and document each one.`,
      );
    },
  };
}
