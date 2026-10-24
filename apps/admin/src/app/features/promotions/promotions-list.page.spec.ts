import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { PromotionsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { PromotionsListPage } from './promotions-list.page';

expect.extend(toHaveNoViolations);

const hourAgo = new Date(Date.now() - 3600_000).toISOString();
const hourAhead = new Date(Date.now() + 3600_000).toISOString();

const fixtures = [
  {
    id: 'p1',
    name: { default: 'Live Percent', en: 'Live Percent' },
    type: 'PERCENTAGE',
    applicationMethod: 'COUPON',
    couponCode: 'LIVE10',
    value: 10,
    isActive: true,
    startsAt: hourAgo,
    endsAt: hourAhead,
  },
  {
    id: 'p2',
    name: { default: 'Scheduled', en: 'Scheduled' },
    type: 'FIXED_AMOUNT',
    applicationMethod: 'COUPON',
    value: 5,
    isActive: true,
    startsAt: hourAhead,
    endsAt: null,
  },
  {
    id: 'p3',
    name: { default: 'Inactive', en: 'Inactive' },
    type: 'FREE_SHIPPING',
    applicationMethod: 'AUTOMATIC',
    value: 0,
    isActive: false,
  },
];

describe('PromotionsListPage', () => {
  let fixture: ComponentFixture<PromotionsListPage>;
  let page: PromotionsListPage;
  let listSpy: jest.Mock;
  let deactivateSpy: jest.Mock;
  let dialogOpen: jest.Mock;
  let dialogResult: boolean;

  function configure(permissions: readonly string[] = ['promotions:view']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: PromotionsService,
          useValue: { list: listSpy, deactivate: deactivateSpy },
        },
        { provide: Dialog, useValue: { open: dialogOpen } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: [...permissions],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(PromotionsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: fixtures, meta: { page: 1, pageSize: 20, total: fixtures.length } }),
    );
    deactivateSpy = jest.fn(() => of(undefined));
    dialogResult = true;
    dialogOpen = jest.fn(() => ({ closed: of(dialogResult) }));
  });

  it('loads promotions and shows the full set', () => {
    configure();
    expect(page.rows()).toHaveLength(3);
    expect(page.total()).toBe(3);
  });

  it('client-side filter narrows to live rows only', async () => {
    configure();
    await TestBed.inject(Router).navigate([], { queryParams: { status: 'live' } });
    fixture.detectChanges();
    expect(page.rows().map((r) => r.id)).toEqual(['p1']);
  });

  it('inactive filter forwards isActive=false to the backend', async () => {
    configure();
    listSpy.mockClear();
    await TestBed.inject(Router).navigate([], { queryParams: { status: 'inactive' } });
    fixture.detectChanges();
    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
  });

  it('surfaces a permission-safe ApiForbiddenError', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the promotions-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Promotions not found.');
  });

  it('computed status derives live from the window', () => {
    configure();
    expect(page.computedStatus(fixtures[0])).toBe('live');
    expect(page.computedStatus(fixtures[1])).toBe('scheduled');
    expect(page.computedStatus(fixtures[2])).toBe('inactive');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  describe('row-level deactivate', () => {
    it('hides the actions column when the user lacks promotions:delete', () => {
      configure(['promotions:view']);
      expect(page.canDeactivateAny()).toBe(false);
      const actionsHeader = fixture.nativeElement.querySelector(
        'th:has(span.sr-only)',
      ) as HTMLElement | null;
      expect(actionsHeader).toBeNull();
    });

    it('renders the actions column when the user has promotions:delete', () => {
      configure(['promotions:view', 'promotions:delete']);
      expect(page.canDeactivateAny()).toBe(true);
      const btn = fixture.nativeElement.querySelector(
        '[data-testid="promo-row-deactivate-p1"]',
      ) as HTMLElement | null;
      expect(btn).not.toBeNull();
    });

    it('does not render the deactivate button for an already-inactive row', () => {
      configure(['promotions:view', 'promotions:delete']);
      const btn = fixture.nativeElement.querySelector(
        '[data-testid="promo-row-deactivate-p3"]',
      ) as HTMLElement | null;
      expect(btn).toBeNull();
    });

    it('opens the confirm dialog, calls deactivate, then refetches on confirm', async () => {
      configure(['promotions:view', 'promotions:delete']);
      listSpy.mockClear();
      await page.confirmDeactivate(fixtures[0] as never);
      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(deactivateSpy).toHaveBeenCalledWith('p1');
      expect(listSpy).toHaveBeenCalled();
    });

    it('does not call deactivate when the confirm is cancelled', async () => {
      dialogResult = false;
      configure(['promotions:view', 'promotions:delete']);
      await page.confirmDeactivate(fixtures[0] as never);
      expect(deactivateSpy).not.toHaveBeenCalled();
    });

    it('surfaces the error banner when deactivate fails with ApiForbiddenError', async () => {
      deactivateSpy = jest.fn(() =>
        throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
      );
      configure(['promotions:view', 'promotions:delete']);
      await page.confirmDeactivate(fixtures[0] as never);
      expect(page.error()).toContain('permission');
    });
  });
});
