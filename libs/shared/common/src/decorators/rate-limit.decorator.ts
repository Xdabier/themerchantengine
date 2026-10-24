import { Throttle, SkipThrottle } from '@nestjs/throttler';

/**
 * Named rate-limit groups (§08 Rate Limiting table).
 * All decorators accept the @nestjs/throttler convention: ttl in seconds.
 *
 * Usage:
 *   @RateLimit.Auth()         – 5 req / 15 min (login, register)
 *   @RateLimit.StorefrontRead()  – 100 req / min (browse, search results)
 *   @RateLimit.StorefrontWrite() – 30 req / min (cart, wishlist mutations)
 *   @RateLimit.Admin()        – 200 req / min (admin panel)
 *   @RateLimit.AssetUpload()  – 30 req / hour (file uploads)
 *   @RateLimit.Search()       – 60 req / min (search endpoints)
 *   @RateLimit.WebhookTest()  – 5 req / min (webhook delivery tests)
 *   @RateLimit.GiftCardLookup() – 10 req / min (gift card validation)
 *   @RateLimit.CouponValidation() – 15 req / min (coupon check)
 *   @RateLimit.Skip()         – disable rate limiting for a route
 */
export const RateLimit = {
  /** 5 requests per 15 minutes — login, register, forgot-password */
  Auth: () => Throttle(5, 15 * 60),

  /** 100 requests per minute — storefront read endpoints */
  StorefrontRead: () => Throttle(100, 60),

  /** 30 requests per minute — storefront write endpoints (cart, wishlist) */
  StorefrontWrite: () => Throttle(30, 60),

  /** 200 requests per minute — admin panel endpoints */
  Admin: () => Throttle(200, 60),

  /** 30 requests per hour — asset/file upload */
  AssetUpload: () => Throttle(30, 60 * 60),

  /** 60 requests per minute — search endpoints */
  Search: () => Throttle(60, 60),

  /** 5 requests per minute — webhook delivery tests */
  WebhookTest: () => Throttle(5, 60),

  /** 10 requests per minute — gift card lookup */
  GiftCardLookup: () => Throttle(10, 60),

  /** 15 requests per minute — coupon/promo validation */
  CouponValidation: () => Throttle(15, 60),

  /** 5 requests per 15 minutes — public contact form (anti-spam) */
  ContactForm: () => Throttle(5, 15 * 60),

  /** 10 requests per minute — manual SEO reindex submit. Tighter than Admin()
   * because every accepted call spends finite IndexNow / GSC / Bing quota
   * (DR-17 §7 — quota-spending endpoints get their own throttle group). */
  SeoSubmit: () => Throttle(10, 60),

  /** 1 request per 5 minutes — live SEO submission-health re-check. The "Re-check
   * now" button is the only live multi-engine probe (GSC sitemaps.list + Bing
   * GetFeeds + public-sitemap fetch); every other status read is served from the
   * cached snapshot. Capped at the operator cadence fixed in DR-17 §8 + §11 #7 so
   * a held button can't hammer the engines. */
  SeoHealthRecheck: () => Throttle(1, 5 * 60),

  /** Bypass rate limiting for a specific route */
  Skip: () => SkipThrottle(),
} as const;
