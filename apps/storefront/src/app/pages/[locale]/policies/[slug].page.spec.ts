import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from '../../../locale.service';
import { type Locale } from '../../../../i18n/types';
import type { PolicySlug } from '../../../../lib/routes';
import { META_TITLE_SEPARATOR } from '../../../../lib/seo';
import { getChromeStrings } from '../../../../i18n';
import PolicyPage from './[slug].page';
import type { PolicyLoadPayload } from './[slug].server';
import { fixtureChromeIdentity } from '../../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
}

const POLICY_FIXTURES: Record<PolicySlug, { titleEn: string; titleFr: string; body: string }> = {
  privacy: {
    titleEn: 'Privacy Policy',
    titleFr: 'Politique de confidentialité',
    body: 'We protect your personal data. Information you share with us is collected only to fulfil your order.',
  },
  returns: {
    titleEn: 'Return Policy',
    titleFr: 'Politique de retour',
    body: 'You can return products within fourteen days of delivery, provided they are in original condition.',
  },
  terms: {
    titleEn: 'Terms of Service',
    titleFr: 'Conditions de service',
    body: 'By using this store, you agree to these terms. Listed prices include VAT.',
  },
  shipping: {
    titleEn: 'Shipping Information',
    titleFr: 'Informations de livraison',
    body: 'We deliver within two to five business days of order confirmation.',
  },
};

function buildLoadPayload(slug: PolicySlug, locale: Locale): PolicyLoadPayload {
  const fixture = POLICY_FIXTURES[slug];
  return {
    slug,
    page: {
      id: `cms-${slug}`,
      slug: `/${slug}`,
      type: 'POLICY',
      title: locale === 'fr' ? fixture.titleFr : fixture.titleEn,
      content: fixture.body,
      metaTitle: null,
      metaDescription: null,
    },
  };
}

async function renderPolicy(opts: {
  locale: Locale;
  slug: PolicySlug;
  payload?: PolicyLoadPayload;
}): Promise<ComponentFixture<PolicyPage>> {
  const payload = opts.payload ?? buildLoadPayload(opts.slug, opts.locale);
  TestBed.overrideComponent(PolicyPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: LocaleService, useValue: new StubLocaleService(opts.locale) },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ slug: opts.slug }),
            queryParamMap: convertToParamMap({}),
            data: { load: payload },
          },
          paramMap: of(convertToParamMap({ slug: opts.slug })),
          queryParamMap: of(convertToParamMap({})),
          data: of({ load: payload }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(PolicyPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

// The store the stub renders, not the neutral one: the page title's suffix
// is the configured store name now (plan E2.5).
const BRAND = fixtureChromeIdentity('demo', 'en').storeName;

describe('PolicyPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  it('renders the privacy heading + body in French', async () => {
    const fixture = await renderPolicy({ locale: 'fr', slug: 'privacy' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#policy-heading')?.textContent?.trim()).toBe(
      POLICY_FIXTURES.privacy.titleFr,
    );
    expect((root.querySelector('.body')?.textContent ?? '').length).toBeGreaterThan(40);
  });

  it('renders each allowlisted slug in English', async () => {
    for (const slug of ['privacy', 'returns', 'terms', 'shipping'] as const) {
      const fixture = await renderPolicy({ locale: 'en', slug });
      const root = fixture.nativeElement as HTMLElement;
      const heading = root.querySelector('#policy-heading')?.textContent?.trim();
      expect(heading).toBe(POLICY_FIXTURES[slug].titleEn);
      TestBed.resetTestingModule();
      document.head.innerHTML = '';
    }
  });

  it('renders a <section> inside LayoutShell (which owns the <main> landmark)', async () => {
    const fixture = await renderPolicy({ locale: 'en', slug: 'terms' });
    expect(fixture.nativeElement.querySelector('main')).toBeNull();
    const section = fixture.nativeElement.querySelector('section');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('aria-labelledby')).toBe('policy-heading');
  });

  it('uses CMS metaTitle / metaDescription when present', async () => {
    const payload: PolicyLoadPayload = {
      slug: 'privacy',
      page: {
        id: 'cms-privacy',
        slug: '/privacy-policy',
        type: 'POLICY',
        title: 'Privacy Policy',
        content: POLICY_FIXTURES.privacy.body,
        metaTitle: 'Privacy — the store',
        metaDescription: 'Our commitment to data privacy.',
      },
    };
    await renderPolicy({ locale: 'en', slug: 'privacy', payload });
    // Every CMS-backed title ends in the brand, via titleWithBrand.
    expect(document.title).toBe(`Privacy — the store${META_TITLE_SEPARATOR}${BRAND}`);
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(desc).toContain('Our commitment to data privacy.');
  });

  it('falls back to title + body excerpt when CMS meta fields are null', async () => {
    await renderPolicy({ locale: 'en', slug: 'privacy' });
    expect(document.title).toBe(`Privacy Policy${META_TITLE_SEPARATOR}${BRAND}`);
    const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.length).toBeLessThanOrEqual(200);
  });

  it('emits og:url scoped to the slug + locale', async () => {
    await renderPolicy({ locale: 'fr', slug: 'shipping' });
    const url = document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? '';
    expect(url).toContain('/fr/policies/shipping');
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const fixture = await renderPolicy({ locale: 'en', slug: 'privacy' });
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
        'landmark-one-main': { enabled: false },
        region: { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
  it('resolves the base URL from the browser origin, never from process.env', async () => {
    // Regression guard. See the sibling test in about.page.spec.ts: both pages
    // read `process.env` unguarded at module level and threw
    // `ReferenceError: process is not defined` on every client render. Setting
    // the variable and asserting it is IGNORED proves the browser branch runs.
    process.env['STOREFRONT_PUBLIC_BASE_URL'] = 'https://server-only.example';
    try {
      await renderPolicy({ locale: 'en', slug: 'privacy' });
      const url = document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? '';
      expect(url).toContain(globalThis.location.origin);
      expect(url).not.toContain('server-only.example');
    } finally {
      delete process.env['STOREFRONT_PUBLIC_BASE_URL'];
    }
  });

  it('renders the CMS body under the shared rich-text typography class', async () => {
    const fixture = await renderPolicy({ locale: 'en', slug: 'privacy' });
    const body = (fixture.nativeElement as HTMLElement).querySelector('.body');
    expect(body?.classList.contains('rich-text-content')).toBe(true);
  });
});

/**
 * Finding N5. The footer links policy to policy, which Analog resolves by
 * re-running this route's loader. The heading and body are computeds over that
 * payload so they already tracked it, but title, canonical, hreflang, the OG
 * block and the JSON-LD applied once in `ngOnInit` and went stale: a reader on
 * /policies/terms saw the privacy title in the tab and the crawler saw the
 * privacy canonical.
 */
describe('PolicyPage sibling-slug meta re-application (finding N5)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
    document.title = '';
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  async function renderLive(locale: Locale = 'en') {
    const first = buildLoadPayload('privacy', locale);
    const data$ = new BehaviorSubject<{ load: PolicyLoadPayload }>({ load: first });
    const snapshot = {
      paramMap: convertToParamMap({ slug: 'privacy' }),
      queryParamMap: convertToParamMap({}),
      data: { load: first },
    };
    TestBed.overrideComponent(PolicyPage, {
      set: { changeDetection: ChangeDetectionStrategy.Default },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LocaleService, useValue: new StubLocaleService(locale) },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot,
            paramMap: of(convertToParamMap({ slug: 'privacy' })),
            queryParamMap: of(convertToParamMap({})),
            data: data$,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(PolicyPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const push = async (slug: PolicySlug) => {
      const payload = buildLoadPayload(slug, locale);
      snapshot.paramMap = convertToParamMap({ slug });
      snapshot.data = { load: payload };
      data$.next({ load: payload });
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, push };
  }

  it('re-applies the document title for the sibling policy', async () => {
    const { push } = await renderLive();
    expect(document.title).toContain(POLICY_FIXTURES.privacy.titleEn);

    await push('terms');

    expect(document.title).toContain(POLICY_FIXTURES.terms.titleEn);
    expect(document.title).not.toContain(POLICY_FIXTURES.privacy.titleEn);
  });

  it('re-applies the canonical and og:url for the sibling policy', async () => {
    const { push } = await renderLive();
    await push('terms');

    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toContain('/policies/terms');
    const ogUrl = document.head.querySelector('meta[property="og:url"]');
    expect(ogUrl?.getAttribute('content')).toContain('/policies/terms');
  });

  it('re-emits the breadcrumb JSON-LD for the sibling policy', async () => {
    const { push } = await renderLive();
    await push('terms');

    const scripts = Array.from(
      document.head.querySelectorAll('script[type="application/ld+json"][data-policy-jsonld]'),
    ).map((el) => el.textContent ?? '');
    expect(scripts.length).toBe(1);
    expect(scripts[0]).toContain('/policies/terms');
    expect(scripts[0]).toContain(POLICY_FIXTURES.terms.titleEn);
  });

  it('renders the sibling policy body', async () => {
    const { fixture, push } = await renderLive();
    await push('shipping');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain(POLICY_FIXTURES.shipping.titleEn);
  });
});
