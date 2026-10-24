import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { provideRouter } from '@angular/router';
import { InventoryService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError, BehaviorSubject } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { InventoryVariantDetailPage } from './inventory-variant-detail.page';

expect.extend(toHaveNoViolations);

/**
 * The response is an envelope, not a bare array, so a variant with NO stock
 * rows still carries the product it belongs to. That case is the reason this
 * screen could previously only print a raw UUID.
 */
function detail(overrides: Record<string, unknown> = {}) {
  return {
    variant: {
      id: 'var-1',
      sku: 'SKU-1',
      product: { id: 'prod-1', name: { default: 'Brosse', fr: 'Brosse', en: 'Brush' } },
    },
    levels: [],
    ...overrides,
  };
}

const LEVEL = {
  id: 'sl-1',
  variantId: 'var-1',
  locationId: 'loc-1',
  onHand: 12,
  reserved: 2,
  available: 10,
  location: { id: 'loc-1', name: 'Lyon', code: 'LYN', isActive: true },
};

describe('InventoryVariantDetailPage', () => {
  let fixture: ComponentFixture<InventoryVariantDetailPage>;
  let getVariantStockSpy: jest.Mock;
  const paramMap$ = new BehaviorSubject({ get: () => 'var-1' });

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: Dialog, useValue: { open: jest.fn() } },
        { provide: InventoryService, useValue: { getVariantStock: getVariantStockSpy } },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['inventory:view', 'inventory:update'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(InventoryVariantDetailPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    getVariantStockSpy = jest.fn(() => of(detail()));
  });

  it('mounts and loads the variant stock breakdown', () => {
    configure();
    expect(getVariantStockSpy).toHaveBeenCalledWith('var-1');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    getVariantStockSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toBe('Variant not found.');
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    getVariantStockSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('links to the product it belongs to', () => {
    configure();
    const link = fixture.nativeElement.querySelector('[data-testid="variant-product-link"]');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/products/prod-1');
    expect(link.textContent.trim()).toBe('Brosse');
  });

  it('offers an explicit action too, since a breadcrumb is easy to miss', () => {
    configure();
    const open = fixture.nativeElement.querySelector('[data-testid="variant-open-product"]');
    expect(open).not.toBeNull();
  });

  /**
   * The case the previous bare-array response could not express: no stock rows
   * anywhere, which is exactly when an operator wants to reach the product.
   */
  it('still links to the product when the variant has no stock rows at all', () => {
    getVariantStockSpy = jest.fn(() => of(detail({ levels: [] })));
    configure();
    expect(
      fixture.nativeElement.querySelector('[data-testid="variant-product-link"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="variant-empty"]')).not.toBeNull();
  });

  it('titles itself with the product name and SKU rather than the raw id', () => {
    getVariantStockSpy = jest.fn(() => of(detail({ levels: [LEVEL] })));
    configure();
    expect(fixture.nativeElement.textContent).toContain('Brosse · SKU-1');
    expect(fixture.nativeElement.textContent).not.toContain('object Object');
  });

  it('renders no product link when the join is absent, rather than a raw id', () => {
    getVariantStockSpy = jest.fn(() =>
      of(detail({ variant: { id: 'var-1', sku: 'SKU-1', product: null } })),
    );
    configure();
    expect(fixture.nativeElement.querySelector('[data-testid="variant-product-link"]')).toBeNull();
  });

  it('renders the per-location rows from the envelope', () => {
    getVariantStockSpy = jest.fn(() => of(detail({ levels: [LEVEL] })));
    configure();
    expect(
      fixture.nativeElement.querySelector('[data-testid="variant-level-loc-1"]'),
    ).not.toBeNull();
  });
});
