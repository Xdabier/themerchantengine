import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StorefrontConfigService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { StorefrontLinkStore } from '../../core/stores/storefront-link.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { StorefrontLinkComponent } from './storefront-link.component';

expect.extend(toHaveNoViolations);

const CONFIG = {
  baseUrl: 'https://demo.example',
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  productPathTemplate: '/{locale}/catalog/product/{slug}',
};

@Component({
  standalone: true,
  imports: [StorefrontLinkComponent],
  template: ` <app-storefront-link [slug]="slug()" [status]="status()" [productName]="name()" /> `,
})
class HostComponent {
  readonly slug = signal<string | null>('brosse-electrique');
  readonly status = signal<string | null>('ACTIVE');
  readonly name = signal<string | null>('Brosse électrique');
}

describe('StorefrontLinkComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let getConfigSpy: jest.Mock;

  function configure(authed = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: StorefrontConfigService, useValue: { getPublicConfig: getConfigSpy } },
      ],
    });
    if (authed) {
      TestBed.inject(AuthStore).setSession({
        user: {
          id: 'u',
          email: 'a@b',
          permissions: ['products:view'],
          roles: [],
          status: 'active',
        },
      });
    }
    TestBed.inject(StorefrontLinkStore);
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  }

  function anchor(): HTMLAnchorElement | null {
    return fixture.nativeElement.querySelector('[data-testid="product-storefront-link"]');
  }

  beforeEach(() => {
    getConfigSpy = jest.fn(() => of(CONFIG));
  });

  it('builds the URL from the served template rather than composing its own path', () => {
    configure();
    expect(anchor()!.getAttribute('href')).toBe(
      'https://demo.example/fr/catalog/product/brosse-electrique',
    );
  });

  it('opens in a new tab safely, asserting every rendered part', () => {
    configure();
    const a = anchor()!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(a.getAttribute('rel')).toContain('noreferrer');
  });

  it('names the product and warns about the new tab in the accessible name', () => {
    configure();
    const label = anchor()!.getAttribute('aria-label') ?? '';
    expect(label).toContain('Brosse électrique');
    expect(label).toContain('new tab');
  });

  it('percent-encodes a slug so it cannot break out of the path', () => {
    configure();
    host.slug.set('a/b c');
    fixture.detectChanges();
    expect(anchor()!.getAttribute('href')).toBe(
      'https://demo.example/fr/catalog/product/a%2Fb%20c',
    );
  });

  /**
   * A draft's public URL 404s, because `getProductBySlug` filters on ACTIVE.
   * Asserting the ABSENCE of an anchor is the point: `aria-disabled` on an
   * anchor that still carries an href stays keyboard-activatable, so it would
   * be a dead link that axe cannot see.
   */
  it('renders no anchor at all for a product that is not live', () => {
    configure();
    host.status.set('DRAFT');
    fixture.detectChanges();
    expect(anchor()).toBeNull();
    const inert = fixture.nativeElement.querySelector(
      '[data-testid="product-storefront-link-inactive"]',
    );
    expect(inert).not.toBeNull();
    expect(inert.textContent).toContain('DRAFT');
    expect(fixture.nativeElement.querySelectorAll('a')).toHaveLength(0);
  });

  /**
   * Two clients are co-hosted, so a guessed origin can open the wrong shop.
   * Nothing is better than something plausible.
   */
  it('renders nothing when the config could not be read', () => {
    getConfigSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('renders nothing before a session exists to hydrate against', () => {
    configure(false);
    expect(getConfigSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('renders nothing without a slug', () => {
    configure();
    host.slug.set(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('falls back to the store default when the operator locale is not served', () => {
    getConfigSpy = jest.fn(() => of({ ...CONFIG, locales: ['en'], defaultLocale: 'en' }));
    configure();
    expect(anchor()!.getAttribute('href')).toContain('/en/catalog/product/');
  });

  it('has no axe violations', async () => {
    configure();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});

describe('StorefrontLinkStore', () => {
  it('does not retry forever after a failed fetch', () => {
    const getPublicConfig = jest.fn(() => throwError(() => new Error('boom')));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: StorefrontConfigService, useValue: { getPublicConfig } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: [], roles: [], status: 'active' },
    });
    const store = TestBed.inject(StorefrontLinkStore);
    TestBed.flushEffects?.();
    expect(getPublicConfig.mock.calls.length).toBeLessThanOrEqual(1);
    expect(store.productUrl('x')).toBeNull();
  });
});
