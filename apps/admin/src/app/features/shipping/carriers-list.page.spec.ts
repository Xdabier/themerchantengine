import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CarriersService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CarriersListPage } from './carriers-list.page';

expect.extend(toHaveNoViolations);

const carriers = [
  {
    id: 'car-1',
    code: 'dhl_express',
    name: { default: 'DHL', en: 'DHL Express' },
    provider: 'dhl',
    services: ['express', 'economy'],
    zones: ['QA', 'AE'],
    isActive: true,
    sortOrder: 0,
    config: { apiKey: '***' },
  },
];

describe('CarriersListPage', () => {
  let fixture: ComponentFixture<CarriersListPage>;
  let page: CarriersListPage;
  let listSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CarriersService, useValue: { list: listSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: ['carriers:view'], roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CarriersListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of({ data: carriers, meta: { page: 1, pageSize: 20, total: 1 } }));
  });

  it('loads rows', () => {
    configure();
    expect(page.rows()).toHaveLength(1);
  });

  it('truncateList keeps 4 items, suffix beyond', () => {
    configure();
    expect(page.truncateList(['A', 'B', 'C', 'D', 'E'])).toContain('+1');
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the carriers-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Carriers not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
