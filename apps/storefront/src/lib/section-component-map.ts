import type { Type } from '@angular/core';
import type { SectionType } from '@storefront-types';

import { CampaignBannerComponent } from '../app/sections/home/campaign-banner.component';
import { CategoriesGridComponent } from '../app/sections/home/categories-grid.component';
import { HeroBannerComponent } from '../app/sections/home/hero-banner.component';
import { ProductRailComponent } from '../app/sections/home/product-rail.component';
import { TrustStripComponent } from '../app/sections/home/trust-strip.component';

/**
 * SSOT component-map per DR-05. Resolves each section type the storefront
 * still renders to the Angular component that renders it. The
 * `Record<Exclude<SectionType, 'PROMOTIONAL_BANNER'>, Type<unknown>>`
 * signature is the exhaustiveness gate: TypeScript fails the storefront build
 * if any new `SectionType` value is added to the storefront-types union
 * without a matching component binding here.
 *
 * `PROMOTIONAL_BANNER` is bound again as of phase B8. D6 removed this client's
 * campaign band and the home page then dropped the type before dispatch, which
 * left the admin selling a section the operator could configure and never see.
 * Brand floor §5.3 forbids a lifestyle scene, not a banner, so the surface was
 * rebuilt inside the floor instead of the type being retired.
 *
 * The home page's dynamic-dispatch path is the only home render path and
 * reads this map directly (see
 * `apps/storefront/src/app/pages/[locale]/index.page.ts`).
 */
export const SECTION_COMPONENT_MAP: Record<SectionType, Type<unknown>> = {
  HERO: HeroBannerComponent,
  PROMOTIONAL_BANNER: CampaignBannerComponent,
  CATEGORY_SHOWCASE: CategoriesGridComponent,
  FEATURED_PRODUCTS: ProductRailComponent,
  TRUST_SIGNALS: TrustStripComponent,
};
