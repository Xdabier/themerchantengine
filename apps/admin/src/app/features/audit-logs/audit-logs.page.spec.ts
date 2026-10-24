import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuditLogService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { NEVER, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuditLogsPage } from './audit-logs.page';

expect.extend(toHaveNoViolations);

const entries = [
  {
    id: 'log-1',
    userId: 'admin-1234567890',
    entityType: 'product',
    entityId: 'prod-abc',
    action: 'update',
    before: { name: 'Old' },
    after: { name: 'New' },
    correlationId: 'corr-12345',
    createdAt: '2026-04-17T10:11:12.000Z',
  },
  {
    id: 'log-2',
    userId: null,
    entityType: 'promotion',
    entityId: 'promo-xyz',
    action: 'deactivate',
    changes: { isActive: false },
    correlationId: 'corr-67890',
    createdAt: '2026-04-17T09:00:00.000Z',
  },
];

describe('AuditLogsPage', () => {
  let fixture: ComponentFixture<AuditLogsPage>;
  let page: AuditLogsPage;
  let listSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: AuditLogService, useValue: { list: listSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['audit_log:view'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(AuditLogsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of({ data: entries, meta: { page: 1, pageSize: 20, total: 2 } }));
  });

  it('loads rows', () => {
    configure();
    expect(page.rows()).toHaveLength(2);
  });

  it('toggleRow flips expansion', () => {
    configure();
    page.toggleRow('log-1');
    expect(page.isExpanded('log-1')).toBe(true);
    page.toggleRow('log-1');
    expect(page.isExpanded('log-1')).toBe(false);
  });

  it('diffRows surfaces changed fields for before/after entries', () => {
    configure();
    const rows = page.diffRows(entries[0] as never);
    expect(rows).toEqual([{ key: 'name', before: 'Old', after: 'New' }]);
  });

  it('diffRows falls back to changes when no before/after', () => {
    configure();
    const rows = page.diffRows(entries[1] as never);
    expect(rows).toEqual([{ key: 'isActive', before: undefined, after: false }]);
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the audit-log-entry-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Audit log entry not found.');
  });

  it('has no axe violations in loaded state', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in loading state', async () => {
    listSpy = jest.fn(() => NEVER);
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in empty state', async () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in error state', async () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('renders a drilldown link when entityType + entityId are both present', () => {
    configure();
    const link = fixture.nativeElement.querySelector(
      '[data-testid="audit-row-link-log-1"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/audit-logs/product/prod-abc');
    expect(link!.getAttribute('aria-label')).toBe('Drill down to Product prod-abc audit entries');
  });

  it('renders the resource type as words while keeping the raw id visible', () => {
    listSpy = jest.fn(() =>
      of({
        data: [{ ...entries[0], id: 'log-gc', entityType: 'gift_card', entityId: 'gc-abcdef' }],
        meta: { page: 1, pageSize: 20, total: 1 },
      }),
    );
    configure();
    const cell = fixture.nativeElement.querySelector(
      '[data-testid="audit-row-link-log-gc"]',
    ) as HTMLElement;
    expect(cell.textContent).toContain('Gift Card');
    expect(cell.textContent).not.toContain('gift_card');
    // The id stays for forensic copyability.
    expect(cell.textContent).toContain('gc-abcdef');
  });

  it('debounces the actor input into the actor query param', () => {
    jest.useFakeTimers();
    try {
      configure();
      const router = TestBed.inject(Router);
      const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      page.onFilterInput('actor', { target: { value: 'Badii' } } as unknown as Event);
      expect(navigate).not.toHaveBeenCalled();

      jest.advanceTimersByTime(300);

      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { actor: 'Badii', page: null } }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('surfaces a clearable chip when a URL carries an invisible userId filter', async () => {
    configure();
    const router = TestBed.inject(Router);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="audit-userid-chip"]'),
    ).toBeNull();

    await router.navigate([], { queryParams: { userId: 'admin-1234567890' } });
    fixture.detectChanges();

    const chip = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="audit-userid-chip"]',
    );
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('admin-1234567890');

    page.clearUserIdFilter();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.userIdFilter()).toBe('');
  });

  it('sends both actor and the legacy userId deep link to the service', async () => {
    configure();
    const router = TestBed.inject(Router);

    await router.navigate([], { queryParams: { actor: 'Badii', userId: 'admin-1' } });
    fixture.detectChanges();

    expect(listSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ actor: 'Badii', userId: 'admin-1' }),
    );
  });

  it('omits the drilldown link when entityId is nullish', () => {
    listSpy = jest.fn(() =>
      of({
        data: [
          {
            ...entries[0],
            id: 'log-3',
            entityType: 'System',
            entityId: null,
          },
        ],
        meta: { page: 1, pageSize: 20, total: 1 },
      }),
    );
    configure();
    const link = fixture.nativeElement.querySelector('[data-testid="audit-row-link-log-3"]');
    expect(link).toBeNull();
  });

  it('renders empty-state copy when the server returns no rows', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No audit entries match');
  });

  it('ApiError surfaces the server-supplied message', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'BOOM', message: 'downstream exploded' })),
    );
    configure();
    expect(page.error()).toBe('downstream exploded');
  });
});
