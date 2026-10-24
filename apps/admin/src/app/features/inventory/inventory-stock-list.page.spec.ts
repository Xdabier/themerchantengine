import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InventoryService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { InventoryStockListPage } from './inventory-stock-list.page';

expect.extend(toHaveNoViolations);

describe('InventoryStockListPage', () => {
  let fixture: ComponentFixture<InventoryStockListPage>;
  let listStockSpy: jest.Mock;
  let listLocationsSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: Dialog, useValue: { open: jest.fn() } },
        {
          provide: InventoryService,
          useValue: { listStockLevels: listStockSpy, listLocations: listLocationsSpy },
        },
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
    fixture = TestBed.createComponent(InventoryStockListPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    listStockSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }),
    );
    listLocationsSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }),
    );
  });

  it('mounts and renders the stock list heading', () => {
    configure();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inventory-stock-list-page"]'),
    ).toBeTruthy();
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    listStockSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    listStockSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toBe('Stock levels not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('says so when the locations lookup fails, and retries on demand', () => {
    listLocationsSpy = jest.fn(() => throwError(() => new Error('offline')));
    configure();

    const notice = fixture.nativeElement.querySelector(
      '[data-testid="inventory-locations-degraded"]',
    );
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('Could not load locations');

    listLocationsSpy.mockReturnValue(
      of({
        data: [{ id: 'loc-1', name: 'Main', code: 'MAIN' }],
        meta: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      }),
    );
    (
      notice.querySelector(
        '[data-testid="inventory-locations-degraded-retry"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(listLocationsSpy).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.locationsError()).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inventory-locations-degraded"]'),
    ).toBeNull();
  });

  it('renders the row status the API sent, never a hardcoded In stock', () => {
    listStockSpy = jest.fn(() =>
      of({
        data: [
          { id: 'sl-out', variantId: 'v1', locationId: 'l1', onHand: 0, status: 'OUT_OF_STOCK' },
          { id: 'sl-low', variantId: 'v2', locationId: 'l1', onHand: 3, status: 'LOW_STOCK' },
        ],
        meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      }),
    );
    configure();

    const badge = (id: string) =>
      fixture.nativeElement.querySelector(`[data-testid="stock-status-${id}"]`) as HTMLElement;
    expect(badge('sl-out').textContent?.trim()).toBe('Out of stock');
    expect(badge('sl-low').textContent?.trim()).toBe('Low stock');
  });

  it('renders a neutral dash when the row carries no status', () => {
    listStockSpy = jest.fn(() =>
      of({
        data: [{ id: 'sl-x', variantId: 'v1', locationId: 'l1', onHand: 42 }],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    );
    configure();

    const badge = fixture.nativeElement.querySelector(
      '[data-testid="stock-status-sl-x"]',
    ) as HTMLElement;
    expect(badge.textContent?.trim()).toBe('—');
    expect(badge.textContent).not.toContain('In stock');
  });

  it('offers a retry when the stock fetch itself fails', () => {
    listStockSpy = jest.fn(() => throwError(() => new Error('offline')));
    configure();

    const error = fixture.nativeElement.querySelector('[data-testid="inventory-error"]');
    expect(error).toBeTruthy();
    const retry = error.querySelector('[data-testid="inventory-error-retry"]') as HTMLButtonElement;
    expect(retry).toBeTruthy();

    listStockSpy.mockReturnValue(
      of({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }),
    );
    retry.click();
    fixture.detectChanges();

    expect(listStockSpy).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.error()).toBeNull();
  });
});
