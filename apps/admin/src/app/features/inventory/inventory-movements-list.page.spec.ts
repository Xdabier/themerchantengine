import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InventoryService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { InventoryMovementsPage } from './inventory-movements-list.page';

expect.extend(toHaveNoViolations);

describe('InventoryMovementsPage', () => {
  let fixture: ComponentFixture<InventoryMovementsPage>;
  let listMovementsSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: InventoryService, useValue: { listMovements: listMovementsSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['inventory:view'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(InventoryMovementsPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    listMovementsSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } }),
    );
  });

  it('mounts and completes the initial fetch', () => {
    configure();
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    listMovementsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    listMovementsSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toBe('Movements not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
