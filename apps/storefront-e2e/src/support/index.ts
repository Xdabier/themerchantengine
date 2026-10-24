/**
 * Shared support helpers for storefront-e2e Playwright specs.
 *
 * The first three are MANDATORY on every `.journey.spec.ts` per
 * `specs/features/storefront-e2e-hardening/plan.md` §4.2 Layer B and
 * `specs/features/full-stack-audit-2026-05-14/plan.md` §1.6:
 *
 *   - `attachConsoleBaseline(page)` — fails the test on any uncaught
 *     pageerror or `console.error` between attach time and `assertClean()`.
 *   - `describeEveryLocale(name, body)` runs the body under every locale the
 *     store under test serves, with each branch surfacing as its own
 *     describe. The set comes from the active scenario fixture (plan E2.3),
 *     as do the direction and the region tail.
 *   - `reloadAndAssertClean(page, route, baseline)` — navigates away and
 *     back after a mutation, asserting state persists and no new console
 *     errors fire across the seam.
 *
 * The auth helpers are the storefront-e2e Better Auth session layer (DR-24,
 * BA4) — the single source of truth that replaced the per-spec JWT
 * `loginViaApi` / `registerViaApi` / Bearer-header blocks:
 *
 *   - `signInViaApi` / `signUpViaApi` — authenticate a customer against the
 *     API and capture the Better Auth session cookies.
 *   - `attachAuthToBrowser(page, session)` — seed those cookies into the
 *     browser context so the SSR shell boots authenticated.
 *   - `authCookieHeader(session)` — build a `Cookie:` header for raw API
 *     calls made as a specific customer.
 */
export {
  attachConsoleBaseline,
  expectedDocumentNotFound,
  type AssertCleanOptions,
  type ConsoleBaseline,
  type ConsoleBaselineEntry,
} from './console-baseline';
export {
  copyFor,
  describeEveryLocale,
  directionOf,
  forFixtureLocales,
  otherLocale,
  otherLocales,
  STOREFRONT_DEFAULT_LOCALE,
  STOREFRONT_HREFLANGS,
  STOREFRONT_LOCALES,
  STOREFRONT_OG_LOCALES,
  type StorefrontLocale,
} from './locale-matrix';
export { waitForHydration } from './hydration';
export {
  activeStoreConfigFixture,
  configuredTaxDisplay,
  configuredVatPercent,
  describeHarnessStoreConfig,
  fixtureShippableAddress,
  harnessStoreConfigFixture,
  harnessStoreConfigFixtureId,
} from './store-config-fixture';
export { reloadAndAssertClean, type ReloadAndAssertOptions } from './reload-and-assert';
export {
  apiHeaders,
  seedOrderInStatus,
  seedProduct,
  signInAsAdmin,
  STOREFRONT_E2E_ADMIN,
  type SeededOrder,
  type SeedOrderTarget,
} from './order-seed';
export {
  attachAuthToBrowser,
  authCookieHeader,
  signInViaApi,
  signUpViaApi,
  STOREFRONT_API_BASE,
  type AuthSession,
  type SignUpInput,
} from './auth-attach';
