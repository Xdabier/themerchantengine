---
"merchants-engine": minor
---

Visual regression baseline wired. `apps/admin-e2e/src/visual-regression.spec.ts`
captures `toHaveScreenshot` assertions across the five unauthenticated
routes × the full viewport matrix. Runs in CI via the new
`.github/workflows/admin-e2e.yml` (Playwright + all three browsers); skipped
on Windows locally due to the Angular-zoneless bootstrap flake documented
in `smoke.spec.ts`. Baselines are CI-owned — set `VISUAL_REGRESSION=1` on
macOS / Linux to re-baseline locally.

Collections module (screen-inventory §5) formally deprecated for v1 —
see `specs/admin-dashboard/decision-records/01-collections-deferred-to-v2.md`.
Zero code impact (nothing was ever shipped); nav item removed so
operators don't see a dead link, screen-inventory updated, revival path
documented. Every concrete merchandising need is already covered by
Categories + Promotions + Search Merchandising Rules.
