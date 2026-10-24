import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiForbiddenError } from '@admin-types';
import { GeoService, SeoService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SeoHealthPage } from './seo-health.page';

expect.extend(toHaveNoViolations);

const populatedReport = {
  data: {
    productsMissingMeta: {
      count: 2,
      items: [
        { id: 'p1', slug: 'sneakers', name: { default: 'Sneakers', en: 'Sneakers' } },
        { id: 'p2', slug: 'shirt', name: { default: 'Shirt', en: 'Shirt' } },
      ],
    },
    productsMissingAlt: {
      count: 1,
      items: [{ id: 'a1', url: 'https://example.test/a.jpg' }],
    },
    pagesMissingMeta: {
      count: 0,
      items: [],
    },
  },
};

describe('SeoHealthPage', () => {
  let fixture: ComponentFixture<SeoHealthPage>;
  let page: SeoHealthPage;
  let healthSpy: jest.Mock;
  let readinessSpy: jest.Mock;

  function configure(perms: string[] = ['seo:view', 'geo:view']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SeoService, useValue: { health: healthSpy } },
        { provide: GeoService, useValue: { getAiReadiness: readinessSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(SeoHealthPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    healthSpy = jest.fn(() => of(populatedReport.data));
    readinessSpy = jest.fn(() =>
      of({
        score: 72,
        signals: {
          answerFirstDescription: 0.8,
          faqEntries: 0.5,
          completeSchemaMarkup: 1,
        },
      }),
    );
  });

  it('renders the store-wide AI-readiness score and its three signals', () => {
    // Finding E4: these used to render on every product page.
    configure();
    const section = fixture.nativeElement.querySelector('[data-testid="seo-ai-readiness"]');
    expect(section).toBeTruthy();
    expect(section.querySelector('[data-testid="seo-ai-readiness-score"]').textContent.trim()).toBe(
      '72',
    );
    expect(section.textContent).toContain('Store-wide score');
    expect(section.textContent).toContain('80%');
    expect(section.textContent).toContain('50%');
    expect(section.textContent).toContain('100%');
  });

  it('hides the AI-readiness section without geo:view', () => {
    configure(['seo:view']);
    expect(fixture.nativeElement.querySelector('[data-testid="seo-ai-readiness"]')).toBeNull();
    expect(readinessSpy).not.toHaveBeenCalled();
  });

  it('offers a retry when the readiness read fails', () => {
    readinessSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'F', message: 'x' })),
    );
    configure();
    const error = fixture.nativeElement.querySelector('[data-testid="seo-ai-readiness-error"]');
    expect(error).toBeTruthy();
    expect(error.textContent).toContain('permission');
  });

  it('parses a populated report and renders all three sections', () => {
    configure();
    expect(page.loading()).toBe(false);
    expect(page.count('productsMissingMeta')).toBe(2);
    expect(page.count('productsMissingAlt')).toBe(1);
    expect(page.count('pagesMissingMeta')).toBe(0);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="health-products-missing-meta"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="health-images-missing-alt"]')).not.toBeNull();
    expect(
      el.querySelector('[data-testid="health-pages-without-meta-description"]'),
    ).not.toBeNull();
  });

  it('shows empty-section caption when a section has zero issues', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('[data-testid="health-pages-without-meta-description-empty"]'),
    ).not.toBeNull();
  });

  it('surfaces a parse error for a malformed response', () => {
    healthSpy = jest.fn(() => of({ bogus: true }));
    configure();
    expect(page.error()).toMatch(/malformed/i);
  });

  it('surfaces a user-safe 403 message', () => {
    healthSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toMatch(/permission/i);
  });

  it('labelFor prefers translatable default, then english, then slug', () => {
    configure();
    const name = page.labelFor(
      { id: 'p1', slug: 'sneakers', name: { default: 'Sneakers', en: 'Sneakers' } },
      'productsMissingMeta',
    );
    expect(name).toBe('Sneakers');
    expect(page.labelFor({ id: 'a1', url: 'https://x' }, 'productsMissingAlt')).toBe('https://x');
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
