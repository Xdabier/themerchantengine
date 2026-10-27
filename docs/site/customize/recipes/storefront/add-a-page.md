---
title: Add a page
description: "A new storefront route under the locale prefix: the page file, its loader when it needs data at first byte, the title, description, canonical and hreflang block, the link helper, and the Playwright journey that runs it under every configured locale."
primaryQuery: add a page analog angular storefront locale route
updated: 2026-09-09
schema: HowTo
---

## When you need this

You want a new public URL on the storefront, for example `/fr/team` and `/en/team`. Every customer-facing route lives under the `[locale]` segment, is server-rendered by Nitro, and carries the head tags a crawler and a link preview read. This page walks the About page at `/{locale}/about`, which reads one CMS page at SSR time. You end with a page component, an optional `.server.ts` loader, the meta block, a link from the chrome through the route helper, and a journey spec that runs under every locale of the fixture and fails on any console error.

## Files you touch

- `apps/storefront/src/app/pages/[locale]/about.page.ts`: the route component. The file name is the path: Analog maps `pages/[locale]/about.page.ts` to `/:locale/about`.
- `apps/storefront/src/app/pages/[locale]/about.server.ts`: the loader, only when the page needs data at first byte. It exports `load`, which Analog wraps into a Nitro endpoint under `/api/_analog/pages/...`.
- `apps/storefront/src/lib/routes.ts`: `APP_ROUTES`, the one place a path is written. Add an entry and link through it.
- `apps/storefront/src/lib/seo.ts`: `staticPageMetaTags`, which builds title, description, canonical, `hreflang` and the Open Graph block for a static path, and `pageTitle`, which appends the brand once. Its input type is `StaticPageMetaInput` at lines 837-847.
- `apps/storefront/src/app/pages/[locale]/about.page.spec.ts`: the component test. It feeds the loader payload through `ActivatedRoute.data`.
- `apps/storefront/src/app/layout/footer.component.spec.ts`: only when you add a footer link. It pins the footer at exactly six routed links and their label order in every locale (lines 172-193) and the six `data-testid` values (lines 310-317), so a seventh link means updating both lists.
- `apps/storefront/src/app/title-suffix.guard.spec.ts` and `apps/storefront/src/app/pages/[locale]/loader-query.guard.spec.ts`: guards you do not edit. The first walks every page file and requires each `setTitle` call to go through `pageTitle`; the second walks every `.server.ts` companion and requires the query to be read through `loaderSearchParams`. Both pass when the page copies `about.page.ts` and `about.server.ts`.
- `apps/storefront-e2e/src/cms-pages.journey.spec.ts` and `apps/storefront-e2e/src/newsletter.journey.spec.ts`: the two journey shapes to copy, one read-only, one with a mutation and the reload step.
- `apps/storefront-e2e/playwright.config.ts`: every spec file is named in a project's `testMatch` allowlist. Add yours.

## The pattern

### 1. Decide whether the page needs a loader

Two shapes exist. `apps/storefront/src/app/pages/[locale]/newsletter/confirm.page.ts` has no loader: it reads `?status=` from `ActivatedRoute` and renders chrome strings. `about.page.ts` has a sibling `about.server.ts` because the copy comes from the API and must be in the SSR HTML. The rule the existing pages follow: a page a crawler should index gets a loader; a private page (`account/*`, `cart`, `checkout`) fetches in the browser behind `isPlatformBrowser` and never has one.

### 2. Write the loader

`apps/storefront/src/app/pages/[locale]/about.server.ts` builds a request-scoped API client, passes the locale from the route params, and turns an upstream 404 into a loader 404:

```ts
export const load = async ({ params, event }: PageServerLoad): Promise<AboutLoadPayload> => {
  const apiClient = createServerApiClient(
    event.node.req as ServerRequest,
    event.node.res as ServerResponse,
    { locale: routeLocale(params) },
  );

  try {
    const envelope = await apiClient.get<ApiResponse<CmsPage>>(`/v1/pages${ABOUT_CMS_SLUG}`);
    return { page: envelope.data };
  } catch (err) {
    if (readErrorStatus(err) === 404) {
      throw createError({ statusCode: 404, statusMessage: 'About page not found' });
    }
    throw err;
  }
};
```

`routeLocale(params)` is required. Inside a Nitro page endpoint the request URL is the internal `/api/_analog/pages/<locale>/...` path, which the URL-prefix parser cannot read, so a loader that omits the option renders the default locale on every page. [Load data at SSR](./load-data-at-ssr.md) covers the client, cookies and query forwarding.

### 3. Read the payload in the component

`apps/storefront/src/app/pages/[locale]/about.page.ts` seeds its signals synchronously from the loader and applies the head in `ngOnInit`:

```ts
protected readonly loaded = toSignal(injectLoad<typeof load>(), { requireSync: true });

protected readonly heading = computed(() => this.loaded().page.title);
protected readonly body = computed(() => this.loaded().page.content);

ngOnInit(): void {
  const t = this.tags();
  this.titleSvc.setTitle(pageTitle(t.title, this.localeService.strings().brand.name));
  this.metaSvc.updateTag({ name: 'description', content: t.description });
  this.metaSvc.updateTag({ property: 'og:title', content: t.og.title });
  this.metaSvc.updateTag({ property: 'og:url', content: t.og.url });
  this.metaSvc.updateTag({ property: 'og:locale', content: t.og.locale });
  upsertPropertyMulti(this.document, 'og:locale:alternate', t.og.localeAlternate);
  this.upsertCanonical(t.canonical);
  this.upsertHreflang(t.hreflang);
  this.applyJsonLd();
}
```

`import type { load } from './about.server'` keeps the loader out of the browser bundle. `requireSync: true` throws if the payload is not there when the component is built, which is the contract Analog's resolver gives.

### 4. Build the head from one call

The same file builds the tag set with `staticPageMetaTags` from `apps/storefront/src/lib/seo.ts`:

```ts
protected readonly tags = computed(() => {
  const page = this.loaded().page;
  const fallbackDescription = stripHtml(page.content).slice(0, 200).trim();
  return staticPageMetaTags({
    locale: this.locale(),
    baseUrl: this.resolveBaseUrl(),
    locales: this.storeConfig.seoLocales(),
    identity: this.localeService.chromeIdentity(),
    path: '/about',
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? fallbackDescription,
  });
});
```

The two config-shaped arguments have named types. `StaticPageMetaInput` in `apps/storefront/src/lib/seo.ts` (lines 837-847) is the contract:

```ts
export interface StaticPageMetaInput {
  locale: Locale;
  baseUrl: string;
  /** The store's name and country, filled into the chrome copy. */
  identity: ChromeIdentity;
  /** The store's locale set and country, for hreflang and og:locale. */
  locales: SeoLocaleContext;
  /** Path under the locale, e.g. `/about` or `/policies/privacy`. */
  path: string;
  title: string;
  description: string;
}
```

`identity` is what `LocaleService.chromeIdentity()` returns and `locales` is what `StoreConfigService.seoLocales()` returns; pass those two signals through rather than building the objects by hand.

The builder appends the brand to the title unless it is already there, clamps the description, sets the canonical to `${baseUrl}/${locale}${path}`, and emits one `hreflang` per locale in `seoLocales().supportedLocales` plus `x-default` at the default locale. The region tail (`fr-XX`, `en_XX`) comes from the configured country through `apps/storefront/src/lib/locale-region.ts`; a store with no country emits the bare language tag.

### 5. Name the route once and link through it

Add the path to `APP_ROUTES` in `apps/storefront/src/lib/routes.ts`:

```ts
about: (locale: Locale) => `/${locale}/about`,
```

Then link with it. `apps/storefront/src/app/layout/footer.component.ts` builds its links from the helper and binds them with `[routerLink]`:

```ts
href: APP_ROUTES.about(loc),
```

No component or template writes `/fr/...` by hand. `apps/storefront/src/lib/routes.spec.ts` pins the helper's output.

### 6. Write the journey spec

`apps/storefront-e2e/src/newsletter.journey.spec.ts` is the full shape: helpers from `./support`, the console baseline around every test, the locale matrix, per-locale copy through `copyFor`, and the reload step after a mutation:

```ts
import {
  attachConsoleBaseline,
  copyFor,
  describeEveryLocale,
  reloadAndAssertClean,
  type ConsoleBaseline,
} from './support';

const HEADING = { en: 'Newsletter', fr: 'Lettre d’information' } as const;

describeEveryLocale('storefront NE9 newsletter', (locale) => {
  let baseline: ConsoleBaseline;
  test.beforeEach(({ page }) => {
    baseline = attachConsoleBaseline(page);
  });
  test.afterEach(() => {
    baseline.assertClean();
  });

  test(`footer signup renders the localized heading (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.getByTestId('newsletter-signup')).toContainText(copyFor(HEADING, locale));
  });
});
```

`describeEveryLocale` (in `apps/storefront-e2e/src/support/locale-matrix.ts`) reads the locale set from the active scenario fixture and runs the body once per locale as its own describe. `attachConsoleBaseline` (`support/console-baseline.ts`) records every `pageerror` and `console.error`, and `assertClean()` throws with the list. `reloadAndAssertClean(page, route, baseline)` (`support/reload-and-assert.ts`) navigates to `/`, back to `route`, then re-asserts the baseline. Finish by adding the file name to the `testMatch` of the `desktop-chromium-1440` project in `apps/storefront-e2e/playwright.config.ts`.

## Tests to run

```bash
npx nx test storefront
npx nx lint storefront
npx nx e2e storefront-e2e --grep=cms-pages
npm run test:storefront-ssr-smoke
```

- `npx nx test storefront` runs the page spec, `apps/storefront/src/lib/routes.spec.ts`, and `apps/storefront/src/app/pages/[locale]/ssr-loaders-locale.spec.ts`, which feeds every loader the internal endpoint URL and asserts `Accept-Language` follows `params.locale`. Add your loader to its `CASES` list. The same run includes `title-suffix.guard.spec.ts` and `loader-query.guard.spec.ts`, which walk every page and loader file on their own and need no entry.
- `npx nx lint storefront` runs the module-boundary and logical-CSS rules on the new component.
- The e2e line runs one journey against the dev server and the seeded test API. Replace `cms-pages` with your spec's name.
- The smoke boots the production Nitro build; run it when your loader reads a query string, because the dev server cannot reproduce that path.

## Gotchas

- A spec file absent from every `testMatch` in `apps/storefront-e2e/playwright.config.ts` collects zero tests and the run is green. `apps/storefront-e2e/src/project-coverage.spec.ts` fails on such a file, so add the name before you rely on the run.
- A loader that throws 404 rejects Analog's resolver, which cancels the navigation before any component mounts and would ship a 200 with an empty `<main>`. `apps/storefront/src/app/app.config.ts` maps it to `/{locale}/not-found` with `skipLocationChange`, and the not-found page sets the 404 status through `injectResponse()`. That target must never get a loader of its own, or the handler loops.
- Do not emit a `<main>` in a page. `apps/storefront/src/app/layout/layout-shell.component.ts` wraps every route in one, and a second fails the axe `landmark-one-main` rule.
- Read `process.env` only behind `isPlatformServer`. `about.page.ts` resolves the public base URL that way because `process` is undefined in the browser bundle and a bare read throws in every `ngOnInit`.
- Apply the head in `ngOnInit`, not in an `effect()`. An effect fires once on the server and again after hydration, and the second run can overwrite a tag with stale data.
- A CMS page that has no dedicated route goes through `cmsPageRoute` in `routes.ts` and lands under `/{locale}/pages/<slug>`. A top-level `[slug].page.ts` would shadow any of the fourteen static segments the `[locale]` directory already owns.
- A hand-rolled `for (const locale of ['fr', 'en'])` pins one install's locale pair. Use `describeEveryLocale`; `copyFor` throws with the locale name when your copy map lacks the locale the fixture serves.
- In a Vitest component spec the jsdom environment configured in `apps/storefront/vite.config.ts` gives `location.origin` the value `http://localhost:3000`, not the dev server's 53300. `about.page.spec.ts` asserts `og:url` against `globalThis.location.origin` for that reason; a canonical or `og:url` assertion that hardcodes the 53300 origin fails.
- A `fill()` against SSR HTML sets the DOM value and hydration then clears it. Use `waitForHydration(page)` from `apps/storefront-e2e/src/support/hydration.ts` before typing into a form.
