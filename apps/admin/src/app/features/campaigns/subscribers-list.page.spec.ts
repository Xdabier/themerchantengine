import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { CampaignsService } from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SubscribersListPage } from './subscribers-list.page';

void adminUi;
expect.extend(toHaveNoViolations);

const subscriberFixture = {
  id: 'sub-1',
  email: 'a@b.com',
  locale: 'en',
  source: 'newsletter-footer',
  confirmedAt: '2026-06-19T00:00:00.000Z',
  unsubscribedAt: null,
  createdAt: '2026-06-19T00:00:00.000Z',
};

describe('SubscribersListPage', () => {
  let fixture: ComponentFixture<SubscribersListPage>;
  let page: SubscribersListPage;
  let listSpy: jest.Mock;
  let updateSpy: jest.Mock;

  function configure(perms: string[] = ['campaigns:view', 'campaigns:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: CampaignsService,
          useValue: { listSubscribers: listSpy, updateSubscriber: updateSpy },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(SubscribersListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: [subscriberFixture], meta: { page: 1, pageSize: 20, total: 1 } }),
    );
    updateSpy = jest.fn(() => of(subscriberFixture));
  });

  it('loads subscriber rows', () => {
    configure();
    expect(page.rows()).toHaveLength(1);
  });

  it('derives the confirmed status label', () => {
    configure();
    expect(page.status(subscriberFixture as never).label).toBe('Confirmed');
  });

  it('toggle calls updateSubscriber and surfaces a notice', () => {
    configure();
    page.toggle(subscriberFixture as never);
    expect(updateSpy).toHaveBeenCalledWith('sub-1', { unsubscribed: true });
    expect(page.notice()).toContain('a@b.com');
  });

  it('canManage is false for view-only perms', () => {
    configure(['campaigns:view']);
    expect(page.canManage()).toBe(false);
  });

  it('403 surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('generic ApiError surfaces the typed message', () => {
    listSpy = jest.fn(() =>
      throwError(
        () => new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom', status: 500 }),
      ),
    );
    configure();
    expect(page.error()).toBe('boom');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  // ── QA D6 sweep: the backend accepts `search`, the page had no box ────────

  function configureWithParams(params: Record<string, string>) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: CampaignsService,
          useValue: { listSubscribers: listSpy, updateSubscriber: updateSpy },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: of(params), snapshot: { queryParams: params } },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['campaigns:view', 'campaigns:manage'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(SubscribersListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renders a search box seeded from the URL and forwards the term', () => {
    configureWithParams({ search: 'sara' });
    const input = fixture.nativeElement.querySelector(
      '[data-testid="subscribers-search"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('sara');
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, search: 'sara' });
  });

  it('onSearch debounces then writes search + resets page', (done) => {
    configure();
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockReturnValue(Promise.resolve(true));
    page.onSearch({ target: { value: 'sara' } } as unknown as Event);
    setTimeout(() => {
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { search: 'sara', page: null },
          queryParamsHandling: 'merge',
        }),
      );
      done();
    }, 300);
  });
});
