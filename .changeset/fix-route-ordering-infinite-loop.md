---
"merchants-engine": patch
---

Fix: admin SPA infinite redirect loop on every public route. The route
table declared `path: ''` with a `{ path: '**' }` child before the
`/auth` block — the wildcard child catch-all matched `/auth/login`,
`/auth/forgot`, and every error route, then authGuard returned a
UrlTree to `/auth/login` which fell into the same match, locking the
main thread in a redirect loop. Fixed by reordering: public routes
(`/auth`, `/403`, `/404`, `/500`, `/dev/design-system`) now declared
BEFORE the authenticated shell, so the router matches them before
the wildcard can eat the path.

Undoes three phases of misdiagnosis: the "Windows + Playwright +
Angular zoneless bootstrap flake" referenced in `smoke.spec.ts`,
`design-system.spec.ts`, and `visual-regression.spec.ts` was never
a flake. The tests were observing the redirect loop running hot on
the main thread. Unit tests stayed green because Angular's
TestBed doesn't run the real router.

Collateral: the previously skipped smoke + design-system e2e
specs are now real coverage (1 + 2 tests); visual regression's
Windows-skip env-var gate is removed; a patch changeset captures
the fix. `.dropzone` data-testid collision in the design-system
demo is scoped to `section[data-testid=...]` so Playwright's
strict-mode locator doesn't trip.

Also: dynamic-import Sentry so the SDK only lands in the bundle
when `environment.sentryDsn` is set — keeps the main chunk under
the Phase 21 80 kB budget even with `@sentry/angular` installed.
