import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InventoryService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { InventoryLocationsPage } from './inventory-locations-list.page';

expect.extend(toHaveNoViolations);

describe('InventoryLocationsPage', () => {
  let fixture: ComponentFixture<InventoryLocationsPage>;
  let listLocationsSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: Dialog, useValue: { open: jest.fn() } },
        { provide: InventoryService, useValue: { listLocations: listLocationsSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['inventory:view', 'inventory:create', 'inventory:update', 'inventory:delete'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(InventoryLocationsPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    listLocationsSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }),
    );
  });

  it('mounts and completes the initial fetch', () => {
    configure();
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    listLocationsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    listLocationsSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toBe('Location not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
