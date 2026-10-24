import { ApiError, ApiForbiddenError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TaxService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { AuthStore } from '../../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../../core/tokens';
import { TaxClassesListPage } from './tax-classes-list.page';

expect.extend(toHaveNoViolations);

const zones = [
  { id: 'z1', name: 'TVA France', countries: ['TN'], rate: 0.19, isActive: true },
  { id: 'z2', name: 'UAE VAT', countries: ['AE'], rate: 0.19, isActive: true },
];
const classes = [
  { id: 'c1', zoneId: 'z1', name: 'Standard', rate: 0.19, isDefault: true },
  { id: 'c2', zoneId: 'z1', name: 'Reduced', rate: 0.025, isDefault: false },
];

describe('TaxClassesListPage', () => {
  let fixture: ComponentFixture<TaxClassesListPage>;
  let page: TaxClassesListPage;
  let listZonesSpy: jest.Mock;
  let listClassesSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let navigateSpy: jest.SpyInstance;

  function configure(
    params: Record<string, string> = {},
    perms: string[] = ['settings:view', 'settings:manage'],
  ) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: TaxService,
          useValue: { listZones: listZonesSpy, listClasses: listClassesSpy },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: queryParams$.asObservable(),
            snapshot: { queryParamMap: convertToParamMap(params) },
          },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    const router = TestBed.inject(Router);
    navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(TaxClassesListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listZonesSpy = jest.fn(() => of({ data: zones, meta: { page: 1, pageSize: 100, total: 2 } }));
    listClassesSpy = jest.fn(() =>
      of({ data: classes, meta: { page: 1, pageSize: 20, total: 2 } }),
    );
  });

  it('renders the loaded classes', () => {
    configure();
    expect(page.rows()).toHaveLength(2);
    expect(page.total()).toBe(2);
  });

  it('resolves each row to its zone name', () => {
    configure();
    expect(page.zoneName('z1')).toBe('TVA France');
    expect(page.zoneName('z2')).toBe('UAE VAT');
  });

  it('falls back to em-dash when the zone is unknown', () => {
    configure();
    expect(page.zoneName('zzz')).toBe('—');
  });

  it('zone-name column stays resilient when listZones() errors', () => {
    listZonesSpy = jest.fn(() => throwError(() => new ApiError({ code: 'ERR', message: 'bad' })));
    configure();
    expect(page.zones()).toHaveLength(0);
    expect(page.zoneName('z1')).toBe('—');
    expect(page.rows()).toHaveLength(2);
  });

  it('formatRate surfaces 0.025 as 2.50%', () => {
    configure();
    expect(page.formatRate(0.025)).toBe('2.50%');
    expect(page.formatRate(0.2)).toBe('20%');
  });

  it('applies zoneId filter from ?zoneId=', () => {
    configure({ zoneId: 'z1' });
    expect(listClassesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ zoneId: 'z1', page: 1, pageSize: 20 }),
    );
  });

  it('omits zoneId when the filter is blank', () => {
    configure();
    const call = listClassesSpy.mock.calls[0][0];
    expect(call.zoneId).toBeUndefined();
  });

  it('onZoneFilterChange navigates with the new zoneId and resets page', () => {
    configure();
    page.onZoneFilterChange('z2');
    expect(navigateSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ zoneId: 'z2', page: null }),
      }),
    );
  });

  it('onZoneFilterChange with empty string clears the filter', () => {
    configure({ zoneId: 'z1' });
    page.onZoneFilterChange('');
    expect(navigateSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ zoneId: null, page: null }),
      }),
    );
  });

  it('goToPage navigates with the new page', () => {
    listClassesSpy = jest.fn(() => of({ data: classes, meta: { page: 1, pageSize: 1, total: 3 } }));
    configure({ pageSize: '1' });
    page.goToPage(2);
    expect(navigateSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { page: 2 } }),
    );
  });

  it('goToPage is a no-op when out of bounds', () => {
    configure();
    navigateSpy.mockClear();
    page.goToPage(0);
    page.goToPage(999);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('empty state surfaces the branded copy', () => {
    listClassesSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No tax classes configured.');
  });

  it('ApiForbiddenError surfaces the permission-safe copy', () => {
    listClassesSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiError with message surfaces verbatim', () => {
    listClassesSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: 'boom' })),
    );
    configure();
    expect(page.error()).toBe('boom');
  });

  it('shows the New class button for settings:manage sessions', () => {
    configure();
    expect(fixture.nativeElement.querySelector('[data-testid="tax-classes-new"]')).not.toBeNull();
  });

  it('hides the New class button for settings:view-only sessions', () => {
    configure({}, ['settings:view']);
    expect(fixture.nativeElement.querySelector('[data-testid="tax-classes-new"]')).toBeNull();
  });

  it('has no axe violations on loading state', async () => {
    listClassesSpy = jest.fn(() => new Subject());
    configure();
    expect(page.loading()).toBe(true);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on loaded state', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on empty state', async () => {
    listClassesSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations on error state', async () => {
    listClassesSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL_ERROR', message: 'boom' })),
    );
    configure();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
