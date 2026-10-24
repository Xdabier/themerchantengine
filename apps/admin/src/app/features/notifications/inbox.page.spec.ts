import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { NotificationsService } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { InboxPage } from './inbox.page';

expect.extend(toHaveNoViolations);

const unread = {
  id: 'n-1',
  userId: 'u',
  type: 'NEW_ORDER',
  title: { default: 'Nouvelle commande', fr: 'Nouvelle commande', en: 'New Order' },
  body: { default: 'Commande 1234 passée', fr: 'Commande 1234 passée', en: 'Order 1234' },
  data: { id: 'o-1' },
  isRead: false,
  readAt: null,
  createdAt: '2026-04-18T10:00:00.000Z',
};

const read = {
  id: 'n-2',
  userId: 'u',
  type: 'LOW_STOCK',
  title: { default: 'Stock bas', fr: 'Stock bas', en: 'Low Stock' },
  body: { default: 'SKU abc has 3 units remaining' },
  data: null,
  isRead: true,
  readAt: '2026-04-18T09:00:00.000Z',
  createdAt: '2026-04-18T08:00:00.000Z',
};

describe('InboxPage', () => {
  let fixture: ComponentFixture<InboxPage>;
  let page: InboxPage;
  let listSpy: jest.Mock;
  let unreadCountSpy: jest.Mock;
  let markReadSpy: jest.Mock;
  let markAllReadSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string | undefined>>;

  function configure(
    perms: string[] = ['notifications:view', 'notifications:manage'],
    initialQuery: Record<string, string | undefined> = {},
  ) {
    queryParams$ = new BehaviorSubject(initialQuery);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: NotificationsService,
          useValue: {
            list: listSpy,
            unreadCount: unreadCountSpy,
            markRead: markReadSpy,
            markAllRead: markAllReadSpy,
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: queryParams$.asObservable() },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(InboxPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: [unread, read], meta: { page: 1, pageSize: 20, total: 2 } }),
    );
    unreadCountSpy = jest.fn(() => of({ unreadCount: 1 }));
    markReadSpy = jest.fn(() => of(undefined));
    markAllReadSpy = jest.fn(() => of(undefined));
  });

  it('mounts + loads rows + surfaces unread count', () => {
    configure();
    expect(page.rows()).toHaveLength(2);
    expect(page.unreadCount()).toBe(1);
    expect(page.loading()).toBe(false);
  });

  it('resolves the title via the active locale', () => {
    configure();
    const n = page.rows()[0];
    expect(page.titleText(n)).toBe('Nouvelle commande');
  });

  it('markRead calls the service, flips the row, and decrements the count', () => {
    configure();
    page.markRead(page.rows()[0]);
    expect(markReadSpy).toHaveBeenCalledWith('n-1');
    const flipped = page.rows().find((r) => r.id === 'n-1');
    expect(flipped?.isRead).toBe(true);
    expect(page.unreadCount()).toBe(0);
    expect(page.notice()).toContain('1 notification');
  });

  it('markRead no-ops when the row is already read', () => {
    configure();
    page.markRead(page.rows()[1]);
    expect(markReadSpy).not.toHaveBeenCalled();
  });

  it('markAllRead calls the service, flips every row, zeroes the count', () => {
    configure();
    page.markAllRead();
    expect(markAllReadSpy).toHaveBeenCalledTimes(1);
    expect(page.unreadCount()).toBe(0);
    expect(page.rows().every((r) => r.isRead)).toBe(true);
    expect(page.notice()).toContain('1 notification');
  });

  it('markAllRead no-ops when unreadCount is 0', () => {
    unreadCountSpy = jest.fn(() => of({ unreadCount: 0 }));
    configure();
    page.markAllRead();
    expect(markAllReadSpy).not.toHaveBeenCalled();
  });

  it('markRead surfaces a 403 branded error and does not flip the row', () => {
    configure();
    markReadSpy.mockReturnValueOnce(
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'x' })),
    );
    page.markRead(page.rows()[0]);
    expect(page.error()).toContain('permission');
    expect(page.rows().find((r) => r.id === 'n-1')?.isRead).toBe(false);
  });

  it('markRead surfaces a 404 branded error', () => {
    configure();
    markReadSpy.mockReturnValueOnce(
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'x' })),
    );
    page.markRead(page.rows()[0]);
    expect(page.error()).toBe('Notification not found.');
  });

  it('403 on list surfaces the branded error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'x' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('generic ApiError on list surfaces the typed message', () => {
    listSpy = jest.fn(() =>
      throwError(
        () => new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'db down', status: 500 }),
      ),
    );
    configure();
    expect(page.error()).toBe('db down');
  });

  it('canManage is false when user lacks notifications:manage', () => {
    configure(['notifications:view']);
    expect(page.canManage()).toBe(false);
  });

  it('unread filter URL triggers isRead=false query', () => {
    configure(undefined, { unread: '1' });
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20, isRead: false });
  });

  it('renders an empty state when no rows', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    unreadCountSpy = jest.fn(() => of({ unreadCount: 0 }));
    configure();
    expect(page.rows()).toHaveLength(0);
    const empty = fixture.nativeElement.querySelector('[data-testid="inbox-empty"]');
    expect(empty).toBeTruthy();
  });

  it('setFilter navigates with unread=1 for unread + null for all', () => {
    configure();
    const router = TestBed.inject(Router);
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.setFilter('unread');
    expect(navigateSpy.mock.calls[0][1]?.queryParams).toMatchObject({ unread: '1', page: null });
    page.setFilter('all');
    expect(navigateSpy.mock.calls[1][1]?.queryParams).toMatchObject({ unread: null, page: null });
  });

  it('has no axe violations when loaded', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when empty', async () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    unreadCountSpy = jest.fn(() => of({ unreadCount: 0 }));
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the error state', async () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'x' })),
    );
    configure();
    expect(page.error()).toBeTruthy();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('markReadLabel disambiguates untitled rows via createdAt', () => {
    configure();
    const untitled = {
      id: 'n-3',
      userId: 'u',
      type: 'GENERIC',
      isRead: false,
      readAt: null,
      createdAt: '2026-04-18T12:34:00.000Z',
    } as never;
    const label = page.markReadLabel(untitled);
    expect(label).toContain('2026-04-18');
    expect(label).toContain('12:34');
    expect(label).not.toBe('Mark Notification as read');
  });
});
