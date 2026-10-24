import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AuditLogService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, NEVER, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuditLogEntityPage } from './audit-log-entity.page';

expect.extend(toHaveNoViolations);

const entries = [
  {
    id: 'log-1',
    userId: 'admin-1234567890',
    user: { id: 'admin-1234567890', email: 'a@b.test' },
    entityType: 'Product',
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
    entityType: 'Product',
    entityId: 'prod-abc',
    action: 'create',
    changes: { status: 'DRAFT' },
    correlationId: 'corr-67890',
    createdAt: '2026-04-17T09:00:00.000Z',
  },
];

describe('AuditLogEntityPage', () => {
  let fixture: ComponentFixture<AuditLogEntityPage>;
  let page: AuditLogEntityPage;
  let listByEntitySpy: jest.Mock;
  let paramMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  function configure() {
    paramMap$ = new BehaviorSubject(
      convertToParamMap({ entityType: 'Product', entityId: 'prod-abc' }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: AuditLogService, useValue: { listByEntity: listByEntitySpy } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParams: of({}),
            snapshot: { paramMap: paramMap$.value, queryParams: {} },
          },
        },
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
    fixture = TestBed.createComponent(AuditLogEntityPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listByEntitySpy = jest.fn(() =>
      of({ data: entries, meta: { page: 1, pageSize: 20, total: 2 } }),
    );
  });

  it('calls listByEntity with the route params', () => {
    configure();
    expect(listByEntitySpy).toHaveBeenCalledWith(
      'Product',
      'prod-abc',
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it('loads rows + total from the response', () => {
    configure();
    expect(page.rows()).toHaveLength(2);
    expect(page.total()).toBe(2);
  });

  it('toggleRow flips expansion for a given entry', () => {
    configure();
    page.toggleRow('log-1');
    expect(page.isExpanded('log-1')).toBe(true);
    page.toggleRow('log-1');
    expect(page.isExpanded('log-1')).toBe(false);
  });

  it('renders the empty-state when listByEntity returns no rows', () => {
    listByEntitySpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No audit entries for this entity',
    );
  });

  it('ApiForbiddenError maps to the permission-safe copy', () => {
    listByEntitySpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError maps to the empty-entity copy', () => {
    listByEntitySpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'gone' })),
    );
    configure();
    expect(page.error()).toBe('No audit entries exist for this entity.');
  });

  it('generic ApiError surfaces the backend message', () => {
    listByEntitySpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'BOOM', message: 'kaboom' })),
    );
    configure();
    expect(page.error()).toBe('kaboom');
  });

  it('goToPage ignores out-of-range values without calling router.navigate', () => {
    configure();
    const navigateSpy = jest.spyOn(TestBed.inject(Router), 'navigate');
    navigateSpy.mockClear();
    page.goToPage(-1);
    page.goToPage(999);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(page.rows()).toHaveLength(2);
  });

  it('renders a back-link anchor targeting /audit-logs', () => {
    configure();
    const back = fixture.nativeElement.querySelector(
      '[data-testid="audit-log-entity-back"]',
    ) as HTMLAnchorElement | null;
    expect(back).not.toBeNull();
    expect(back!.tagName).toBe('A');
    expect(back!.getAttribute('href')).toBe('/audit-logs');
  });

  it('truncates long entity ids with an ellipsis', () => {
    configure();
    expect(page.truncateId('')).toBe('');
    expect(page.truncateId('short')).toBe('short');
    expect(page.truncateId('a'.repeat(40)).endsWith('…')).toBe(true);
  });

  it('has no axe violations in loaded state', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in empty state', async () => {
    listByEntitySpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in loading state', async () => {
    listByEntitySpy = jest.fn(() => NEVER);
    configure();
    expect(page.loading()).toBe(true);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in error state', async () => {
    listByEntitySpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'no' })),
    );
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
