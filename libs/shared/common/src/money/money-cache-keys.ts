/**
 * The Redis keyspaces that cache money, a currency or a tax rate, and why
 * each one holds money. Read by two flushers that must agree:
 * `prisma/flush-money-cache.ts` after a seed, and the in-process listener on
 * `store-config.updated` after a settings or currencies write (plan E1.4.4).
 *
 *  - `tax:zone:*`: resolved tax zones, 1 h TTL. `tax:zone:__default__` is the
 *    sharpest, it is country-agnostic and the key the fallback path reads.
 *  - `shipping:zones:*`: resolved shipping zones and their rates, 15 min.
 *  - `products:detail:*`: storefront product detail, 5 min, carries prices.
 *  - `geo:llms.txt:*` and `geo:llms-full.txt:*`: 6 h, and a CDN `max-age` of
 *    a day sits in front of the routes that serve them.
 *  - `seo:merchant-feed`: the Google Merchant XML, which embeds the amount and
 *    the currency code in every `<g:price>`.
 *
 * Deliberately NOT `FLUSHALL`. The same Redis holds BullMQ queues and
 * idempotency keys; wiping those would drop in-flight jobs and let a replayed
 * request create a second order.
 */
export const MONEY_CACHE_KEY_PATTERNS: readonly string[] = Object.freeze([
  'tax:zone:*',
  'shipping:zones:*',
  'products:detail:*',
  'geo:llms.txt:*',
  'geo:llms-full.txt:*',
  'seo:merchant-feed',
]);
