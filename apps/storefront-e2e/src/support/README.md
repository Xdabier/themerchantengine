# storefront-e2e/support

Shared Playwright helpers mandated by `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B. Every `.journey.spec.ts` in this directory must wire all three.

## Helpers

| File | Export | What it does |
|---|---|---|
| `console-baseline.ts` | `attachConsoleBaseline(page)` | Captures every `pageerror` and `console.error` between attach time and `assertClean()`. Throws with a punch list if any fired. |
| `locale-matrix.ts` | `describeEveryLocale(name, body)` | Runs the body under every locale the active fixture serves (default first), with each branch surfacing as its own `test.describe('... @<locale>')`. |
| `reload-and-assert.ts` | `reloadAndAssertClean(page, route, baseline)` | Navigates the page away (intermediate route, default `/`) then back to `route`, asserting the console baseline stays clean. Use after every mutation journey. |

Barrel at `./index.ts` re-exports all three.

## Mandatory wiring template

```ts
import { test } from '@playwright/test';
import {
  attachConsoleBaseline,
  describeEveryLocale,
  reloadAndAssertClean,
  type ConsoleBaseline,
} from './support';

test.describe('<feature name> journey', () => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  describeEveryLocale('<feature> mutation', (locale) => {
    test(`<scenario> (${locale})`, async ({ page }) => {
      // ... drive the mutation ...
      await reloadAndAssertClean(page, `/${locale}/<route>`, baseline);
    });
  });
});
```

## Migration status

All 37 `.journey.spec.ts` files plus `smoke.spec.ts` in `apps/storefront-e2e/src/` carry the baseline, verified at the phase D2 exit gate by `storefront-console-error-guard-auditor`.

The original sweep landed 2026-05-14 across 33 specs, in commits `7681068` (helpers + reviews + auth), `775755a` (30-spec mass migration), and the allowlist-support commit that closed the `error-pages` carve-out (run `git log --oneline -- apps/storefront-e2e/src/support` for the exact hash). Five specs have been added since and were wired to the same pattern on arrival: `locale-leak-ssr`, `newsletter`, `notification-preferences`, and the two phase D6 brand-floor journeys, `product-availability` and `price-tax-mention`. Keep this count current, because a new spec that skips the baseline is exactly what the auditor exists to catch.

## Allowlist contract

A spec that intentionally provokes a noisy console pattern (a framework warning, an expected network failure inside an intentional-error surface, etc.) can filter known-noise entries via `assertClean({ ignore })`:

```ts
test.afterEach(() => {
  baseline.assertClean({
    ignore: [
      /Failed to load resource/i,     // expected when the page renders /500
      (entry) => entry.kind === 'pageerror' && entry.message.includes('cancelled by hydration'),
    ],
  });
});
```

Rules:

1. **Every ignore pattern carries a comment** citing the specific framework version, test path, or scenario that produces it. Silent ignore additions drift over time — the next bug of the same shape would also slip through.
2. **Patterns must be specific.** A blanket `/error/i` or `/.+/` defeats the purpose. Match on the exact message fragment the framework produces.
3. **Prefer fixing the source.** If a console error originates in storefront code, the right fix is to remove the source, not to ignore it. Ignore is only for genuinely-out-of-our-control noise.

The `storefront-console-error-guard-auditor` agent (`.claude/agents/`) flags any ignore pattern without an adjacent comment + raises every undocumented carve-out as a BLOCKER.

## Auditor enforcement

When the six auditors land (`storefront-e2e-hardening` P2 / P3), `storefront-console-error-guard-auditor` greps every `.journey.spec.ts` for `attachConsoleBaseline` and fails the phase exit if any spec lacks it.
