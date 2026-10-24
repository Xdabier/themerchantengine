import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InventoryService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { InventoryAlertsPage } from './inventory-alerts-list.page';

expect.extend(toHaveNoViolations);

describe('InventoryAlertsPage', () => {
  let fixture: ComponentFixture<InventoryAlertsPage>;
  let listAlertsSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: Dialog, useValue: { open: jest.fn() } },
        { provide: InventoryService, useValue: { listAlerts: listAlertsSpy } },
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
    fixture = TestBed.createComponent(InventoryAlertsPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    listAlertsSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }),
    );
  });

  it('mounts and renders the alerts page', () => {
    configure();
    expect(
      fixture.nativeElement.querySelector('[data-testid="inventory-alerts-page"]'),
    ).toBeTruthy();
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    listAlertsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    listAlertsSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toBe('Alerts not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
