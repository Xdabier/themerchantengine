/**
 * `ctaHref` scheme allowlist for storefront section configs (HERO,
 * PROMOTIONAL_BANNER). Per the S21 admin-security-reviewer H-2 finding:
 * the field accepts an operator-controlled URL and round-trips through the
 * public `GET /v1/storefront/sections/:pageSlug` response. Without a
 * scheme allowlist, an operator with `storefront_config:manage` can stage
 * stored XSS / open-redirect (`javascript:`, `data:`, `vbscript:`,
 * schemeless `//evil.com`) for any future renderer that wires
 * `[href]="cfg.ctaHref"` directly. The current renderer ignores the
 * field and routes via `[routerLink]="catalogRoute()"`, which keeps
 * the surface unexploitable today, but the validator must defend the
 * persisted shape.
 *
 * Allowed:
 *   - Site-relative path:           `/...`
 *   - Absolute http(s) URL:         `https://...`, `http://...`
 *
 * Rejected:
 *   - Scheme-relative (network-path) `//evil.com`
 *   - Backslash-prefixed `\/\/evil.com` (some browsers normalize to `//`)
 *   - Other schemes: `javascript:`, `data:`, `vbscript:`, `file:`,
 *     `ftp:`, `mailto:`, `tel:`
 *
 * The mirroring admin form validator at
 * `apps/admin/src/app/features/storefront/section-editors/build-config-forms.ts`
 * uses the same regex via the same source so the contracts cannot drift.
 */
export const CTA_HREF_SCHEME_REGEX = /^(\/[^/\\]|https?:\/\/)/;

export const CTA_HREF_SCHEME_MESSAGE =
  'ctaHref must start with "/" (site-relative) or "https://" / "http://" (absolute URL). Schemeless "//", schemes other than http/https, and backslash variants are rejected.';
