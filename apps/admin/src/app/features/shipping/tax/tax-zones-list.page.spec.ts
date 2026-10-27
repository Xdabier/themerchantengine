import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TaxService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../../core/tokens';
import { TaxZonesListPage } from './tax-zones-list.page';

expect.extend(toHaveNoViolations);

const zones = [
  {
    id: 'z1',
    name: 'TVA France',
    countries: ['TN'],
    rate: 0,
    isDefault: false,
    isActive: true,
  },
  {
    id: 'z2',
    name: 'EU Standard',
    countries: ['DE', 'FR', 'IT', 'ES', 'NL'],
    rate: 0.2,
    isDefault: true,
    isCompound: true,
    priority: 5,
    isActive: true,
  },
];

describe('TaxZonesListPage', () => {
  let fixture: ComponentFixture<TaxZonesListPage>;
  let page: TaxZonesListPage;
  let listSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: TaxService, useValue: { listZones: listSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: ['settings:view'], roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(TaxZonesListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of({ data: zones, meta: { page: 1, pageSize: 20, total: 2 } }));
  });

  it('loads rows', () => {
    configure();
    expect(page.rows()).toHaveLength(2);
  });

  it('formatRate surfaces 0.2 as 20%', () => {
    configure();
    expect(page.formatRate(0.2)).toBe('20%');
    expect(page.formatRate(0.05)).toBe('5%');
  });

  it('countryList truncates long lists with +N', () => {
    configure();
    expect(page.countryList(zones[1] as never)).toContain('+');
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the tax-zones-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Tax zones not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
