# Runbook — Social-share preview cache eviction

**Audience:** storefront operators handling post-deploy verification or customer reports of stale share previews.
**Authored:** 2026-05-04 (SH7 of `storefront-ssr-data-hydration`).
**Companion docs:**
- `specs/features/storefront-ssr-data-hydration/spec.md` §1 Defect A (root cause), §5 (out of scope — cache eviction is a platform behaviour, not a code defect).
- `agent_docs/storefront/seo-geo.md` `## SSR contract` (the OG / JSON-LD emit table the storefront now satisfies on first byte).

## 1. Why this runbook exists

The SSR data-hydration feature ships content-rich Open Graph + JSON-LD on the first byte of every public route. Crawlers that scrape a URL **after the deploy** see the correct preview immediately. Crawlers that scraped a URL **before the deploy** continue to serve their cached (favicon-fallback) preview until each platform's TTL expires.

Cache eviction is platform-controlled. The storefront codebase has no API to force a remote scraper to re-fetch. This runbook documents the per-platform eviction surface so an operator can:
- verify a fix is live by triggering a fresh scrape on one URL,
- handle a customer ticket reporting a stale preview by force-rescraping the offending URL,
- understand which platforms cannot be force-evicted and require a wait-out window.

## 2. Per-platform cache surface

### 2.1 WhatsApp

- **Cache TTL:** ~7 days from first scrape. No API to force-evict.
- **Workaround for testing:** append a query string the platform has not seen before — `?v=2` or `?cb=<timestamp>` — to the URL when sharing in a chat. WhatsApp treats the query-distinct URL as fresh and triggers a new scrape. The query string is harmless to the storefront route handler (the `[locale]/catalog/product/[slug].server.ts` companion ignores unknown query params and returns the canonical product payload).
- **Customer-reported stale preview:** advise the customer that the preview will refresh within a week; for an immediate fix, share the URL with `?v=<n>` appended.
- **Verification step:** share the canonical URL plus `?v=<currentEpoch>` to a WhatsApp chat. The preview MUST show the product image, the locale-resolved product name, and the locale-resolved description. A favicon-only preview indicates the SSR contract is broken — see §4 below.

### 2.2 Facebook + Instagram

- **Cache TTL:** ~30 days from first scrape, force-evictable via the **Facebook Sharing Debugger**.
- **Force-rescrape link:** https://developers.facebook.com/tools/debug/
- **Procedure:**
  1. Paste the canonical URL (e.g. `https://<storefront-domain>/ar/catalog/product/<slug>`) into the Sharing Debugger input.
  2. Click **Debug**. Inspect the "When and how we last scraped the URL" timestamp.
  3. Click **Scrape Again**. The tool re-issues `GET <url>` with the Facebook scraper user-agent and updates the cached preview.
  4. Re-share the URL on Facebook or Instagram; the preview reflects the new scrape immediately.
- **Verification step:** after force-rescraping, the debugger preview pane MUST show the product image (the `large`-variant URL of the primary asset per AC-1), the locale-resolved product name in the `og:title` row, and the locale-resolved description in the `og:description` row. The "og:image" row MUST resolve to the asset storage URL, never to the storefront favicon or brand mark.

### 2.3 LinkedIn

- **Cache TTL:** ~7 days from first scrape, force-evictable via the **LinkedIn Post Inspector**.
- **Force-rescrape link:** https://www.linkedin.com/post-inspector/
- **Procedure:**
  1. Paste the canonical URL into the Post Inspector input.
  2. Click **Inspect**. The tool re-fetches the URL and renders the parsed OG card.
  3. Verify the rendered card shows the product image, name, and description.
- **Customer-reported stale preview:** running the Post Inspector once per offending URL is sufficient — LinkedIn's cache updates immediately on a successful re-fetch.

### 2.4 Twitter / X

- **Cache TTL:** historically ~7 days, force-evictable via the **Twitter Card Validator**. Note that the Card Validator was deprecated for new accounts in 2023 and is unreliable in 2026; the tool may return "card disabled" for accounts that did not pre-register before deprecation.
- **Force-rescrape link (when available):** https://cards-dev.twitter.com/validator
- **Reach in 2026:** Twitter's organic reach for shared product URLs has dropped to a level where this surface is rarely worth operator effort. Do not block a deploy on Twitter cache eviction. If a customer reports a stale Twitter preview, advise that the preview will refresh within a week of the next share.

### 2.5 AI crawlers (`ClaudeBot`, `GPTBot`, `PerplexityBot`, Bingbot)

- **Cache surface:** crawler-controlled, no operator-facing eviction tool. Crawlers re-fetch on their own schedule (typically 24h–7d for high-traffic surfaces).
- **Verification step:** there is no per-URL force-rescrape. Confirm the SSR HTML is correct via the post-deploy verification step in §3 below; the next crawler pass will pick up the corrected content.

## 3. Post-deploy verification step

After every storefront deploy that touches an SSR-emitting route (any file under `apps/storefront/src/app/pages/[locale]/**` or `apps/storefront/src/server/**`), run this verification on at least one product URL:

```bash
# 1. Raw SSR scrape — confirm the OG block and JSON-LD are present on first byte.
curl -sS https://<storefront-domain>/ar/catalog/product/<slug> \
  | grep -E '(og:image|og:title|og:description|og:type|application/ld\+json)' \
  | head -20

# 2. Confirm the og:image resolves to the asset storage URL, NOT the brand favicon.
curl -sS https://<storefront-domain>/ar/catalog/product/<slug> \
  | grep -oP 'og:image"\s+content="\K[^"]+'
# Expected: an https://<cdn-host>/.../large.webp URL.
# Defect: a /brand/... favicon or mark path. STOP, file a P1, see §4.

# 3. Force-rescrape one canonical URL via the Facebook Sharing Debugger
#    and verify the preview pane shows the product image.
#    https://developers.facebook.com/tools/debug/
```

Run the same three steps on `https://<storefront-domain>/ar/` (home) and at least one `/ar/catalog/<category>` URL. The home page scrape MUST contain `og:type="website"`, the Organization + WebSite + BreadcrumbList JSON-LD blocks, and a populated `[data-testid="home-categories"]` section.

## 4. Failure modes

If §3 step 2 returns the brand favicon URL instead of the CDN asset URL, the SSR contract is broken — the page is hitting one of these regression paths:

| Symptom | Likely root cause | First diagnostic |
|---|---|---|
| `og:image` is the favicon on every product URL | `STOREFRONT_API_CLIENT` SSR provider missing or the `.server.ts` companion is not loading the product. | `curl -sS <url> \| head -100` — if no `og:` tags at all, the companion `load` failed silently. Check Nitro logs for the `<route>.server.ts` handler error. |
| `og:image` correct on `/en/...` but favicon on `/ar/...` | Locale resolution in the SSR client is falling back to `Accept-Language` instead of URL prefix (clarifications §1.2). | Reproduce with `curl -H 'Accept-Language: en-US' https://<storefront-domain>/ar/catalog/product/<slug>` — if the response is English content, the URL-prefix derivation regressed. |
| `og:image` missing entirely (404 / 500 on the `.server.ts` companion) | API outage on `/v1/products/<slug>` upstream. | Check the API health endpoint at `/v1/health`; check the storefront error rate for the `.server.ts` companion in observability. |
| `og:image` is `https://localhost:53000/...` or `/api/v1/products/...` | The asset-variant resolver is emitting a relative URL or a dev-host URL. | `apps/storefront/src/lib/asset-variant.ts` resolver — confirm it uses the asset storage public base URL, not the API base URL. |

For any of the above, file a P1 against this feature's spec (`specs/features/storefront-ssr-data-hydration/spec.md`) and revert the offending deploy via the standard deploy-rollback procedure. The SSR contract is non-negotiable per AC-1 + AC-2 + AC-3.

## 5. Customer-facing copy

For a support agent answering a customer reporting a stale share preview:

> **WhatsApp / LinkedIn / Facebook:** "We updated the product preview earlier this week. The chat / post you're seeing was generated against our older preview, which is cached for up to 7 days on WhatsApp and up to 30 days on Facebook. The fastest workaround is to share the link a second time — most platforms re-fetch automatically. For an immediate refresh, you can paste the URL into the platform's debugger tool (we can do this for you if you share the URL with us)."
>
> **Twitter / X:** "Twitter's preview cache may take up to a week to refresh after a content update. We don't currently have a tool to force-refresh Twitter previews; the next share will trigger a fresh scrape."

Do NOT promise an immediate fix on WhatsApp — the platform genuinely has no operator-facing eviction surface. Set the expectation at 7 days.
