import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { StorefrontConfigService } from './storefront-config.service';

const SECTION_ID = 'b4f5c9a4-1a1a-4a4a-8a8a-ab0000000010';
const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';

const heroConfig = {
  assetId: ASSET_ID,
  eyebrow: { default: 'Summer' },
  headline: { default: 'Sun and surf' },
  body: { default: 'Discover the new collection' },
  cta: { default: 'Shop now' },
  ctaHref: '/catalog',
};

const sectionFixture = {
  id: SECTION_ID,
  pageSlug: 'collections/summer',
  type: 'HERO',
  title: { default: 'Summer', en: 'Summer' },
  config: heroConfig,
  sortOrder: 0,
  isVisible: true,
};

describe('StorefrontConfigService', () => {
  let service: StorefrontConfigService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        StorefrontConfigService,
      ],
    });
    service = TestBed.inject(StorefrontConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listPages() GETs /storefront/pages', (done) => {
    service.listPages().subscribe((res) => {
      expect(res.data).toEqual([]);
      done();
    });
    const req = http.expectOne('/api/v1/admin/storefront/pages');
    expect(req.request.method).toBe('GET');
    req.flush({ data: [] });
  });

  it('listSections() preserves slug slashes without encoding them', (done) => {
    service.listSections('collections/summer').subscribe(() => done());
    const req = http.expectOne(
      (r) => r.url === '/api/v1/admin/storefront/pages/collections/summer/sections',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ data: [sectionFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listSections() rejects invalid slugs (uppercase)', () => {
    expect(() => service.listSections('Bad Slug').subscribe()).toThrow();
    http.expectNone('/api/v1/admin/storefront/pages/Bad Slug/sections');
  });

  it('reorderSections() PATCHes /reorder with ordered ids', (done) => {
    service.reorderSections('home', { orderedIds: [SECTION_ID] }).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/storefront/pages/home/sections/reorder');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.orderedIds).toHaveLength(1);
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('reorderSections() rejects empty orderedIds', () => {
    expect(() => service.reorderSections('home', { orderedIds: [] }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/storefront/pages/home/sections/reorder');
  });

  // ── Per-type discriminated-union submit gates ────────────────────────────

  it('createSection() POSTs a HERO with a valid per-type config', (done) => {
    service
      .createSection('home', { type: 'HERO', config: heroConfig, isVisible: true })
      .subscribe((section) => {
        expect(section.type).toBe('HERO');
        done();
      });
    const req = http.expectOne('/api/v1/admin/storefront/pages/home/sections');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.type).toBe('HERO');
    expect(req.request.body.config.assetId).toBe(ASSET_ID);
    req.flush({ data: sectionFixture });
  });

  it('createSection() rejects an unknown type before the wire', () => {
    expect(() =>
      service
        .createSection('home', {
          type: 'TESTIMONIALS' as never,
          config: { quote: { default: 'x' } } as never,
        } as never)
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/storefront/pages/home/sections');
  });

  it('createSection() rejects a HERO with a wrong-shape config', () => {
    expect(() =>
      service
        .createSection('home', {
          type: 'HERO',
          // missing required fields (assetId, headline, etc.)
          config: { headline: { default: 'no-asset' } } as never,
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/storefront/pages/home/sections');
  });

  it('createSection() rejects a HERO whose config carries an unknown field', () => {
    expect(() =>
      service
        .createSection('home', {
          type: 'HERO',
          config: { ...heroConfig, sneaky: 'no' } as never,
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/storefront/pages/home/sections');
  });

  it('createSection() POSTs a CATEGORY_SHOWCASE with categoryIds', (done) => {
    service
      .createSection('home', {
        type: 'CATEGORY_SHOWCASE',
        config: { categoryIds: [CATEGORY_ID], heading: { default: 'Shop' } },
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/storefront/pages/home/sections');
    expect(req.request.body.config.categoryIds).toEqual([CATEGORY_ID]);
    req.flush({
      data: {
        ...sectionFixture,
        type: 'CATEGORY_SHOWCASE',
        config: { categoryIds: [CATEGORY_ID], heading: { default: 'Shop' } },
      },
    });
  });

  it('createSection() POSTs a FEATURED_PRODUCTS with productIds + variant', (done) => {
    service
      .createSection('home', {
        type: 'FEATURED_PRODUCTS',
        config: { productIds: [PRODUCT_ID], variant: 'scroll' },
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/storefront/pages/home/sections');
    expect(req.request.body.config.variant).toBe('scroll');
    req.flush({
      data: {
        ...sectionFixture,
        type: 'FEATURED_PRODUCTS',
        config: { productIds: [PRODUCT_ID], variant: 'scroll' },
      },
    });
  });

  it('createSection() POSTs a TRUST_SIGNALS with at least one item', (done) => {
    service
      .createSection('home', {
        type: 'TRUST_SIGNALS',
        config: {
          items: [
            {
              kind: 'delivery',
              title: { default: 'Fast' },
              subtitle: { default: 'Two-day' },
            },
          ],
        },
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/storefront/pages/home/sections');
    expect(req.request.body.config.items).toHaveLength(1);
    req.flush({
      data: {
        ...sectionFixture,
        type: 'TRUST_SIGNALS',
        config: {
          items: [
            {
              kind: 'delivery',
              title: { default: 'Fast' },
              subtitle: { default: 'Two-day' },
            },
          ],
        },
      },
    });
  });

  it('createSection() rejects TRUST_SIGNALS with zero items', () => {
    expect(() =>
      service
        .createSection('home', {
          type: 'TRUST_SIGNALS',
          config: { items: [] as never },
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/storefront/pages/home/sections');
  });

  it('updateSection() PATCHes envelope-only fields without a config', (done) => {
    service.updateSection(SECTION_ID, { sortOrder: 2 }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/storefront/sections/${SECTION_ID}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.sortOrder).toBe(2);
    expect(req.request.body.config).toBeUndefined();
    req.flush({ data: sectionFixture });
  });

  it('updateSection() PATCHes a fresh per-type config replacement', (done) => {
    service.updateSection(SECTION_ID, { type: 'HERO', config: heroConfig }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/storefront/sections/${SECTION_ID}`);
    expect(req.request.body.type).toBe('HERO');
    expect(req.request.body.config.assetId).toBe(ASSET_ID);
    req.flush({ data: sectionFixture });
  });

  it('updateSection() rejects a config without a type discriminator', () => {
    expect(() =>
      service.updateSection(SECTION_ID, { config: heroConfig } as never).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/storefront/sections/${SECTION_ID}`);
  });

  it('deleteSection() DELETEs section', (done) => {
    service.deleteSection(SECTION_ID).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/storefront/sections/${SECTION_ID}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('toggleVisibility() PATCHes /visibility', (done) => {
    service.toggleVisibility(SECTION_ID, { isVisible: false }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/storefront/sections/${SECTION_ID}/visibility`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.isVisible).toBe(false);
    req.flush({ data: { ...sectionFixture, isVisible: false } });
  });
});
