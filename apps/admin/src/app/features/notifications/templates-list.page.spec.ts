import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificationTemplatesService, SettingsService } from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { TemplatesListPage } from './templates-list.page';

expect.extend(toHaveNoViolations);

const templates = [
  {
    id: 't-order',
    code: 'order.shipped',
    subject: { default: 'Shipped' },
    body: { default: 'x' },
    channel: 'email',
    event: 'order.shipped',
    variables: [],
    isEnabled: true,
    sendEnabled: true,
    category: 'TRANSACTIONAL',
    isLocked: true,
  },
  {
    id: 't-gift',
    code: 'giftcard.purchase',
    subject: { default: 'Gift' },
    body: { default: 'x' },
    channel: 'email',
    event: 'giftcard.purchased',
    variables: [],
    isEnabled: true,
    sendEnabled: true,
    category: 'TRANSACTIONAL',
    isLocked: false,
  },
  {
    id: 't-cart',
    code: 'cart.abandoned',
    subject: { default: 'Cart' },
    body: { default: 'x' },
    channel: 'email',
    event: 'cart.abandoned',
    variables: [],
    isEnabled: true,
    sendEnabled: false,
    category: 'LIFECYCLE',
    isLocked: false,
  },
];

function digest(id: string, code: string) {
  return {
    id,
    code,
    subject: { default: code },
    body: { default: 'x' },
    channel: 'email',
    event: code,
    variables: [],
    isEnabled: true,
    sendEnabled: true,
    category: 'TRANSACTIONAL',
    isLocked: false,
  };
}

describe('TemplatesListPage (matrix)', () => {
  let fixture: ComponentFixture<TemplatesListPage>;
  let page: TemplatesListPage;
  let listSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let settingsGetSpy: jest.Mock;
  let settingsUpdateSpy: jest.Mock;

  function configure(perms: string[] = ['notifications:view', 'notifications:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: NotificationTemplatesService,
          useValue: { listTemplates: listSpy, updateTemplate: updateSpy },
        },
        {
          provide: SettingsService,
          useValue: { getAll: settingsGetSpy, update: settingsUpdateSpy },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(TemplatesListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  const evt = (checked: boolean) => ({ target: { checked } }) as unknown as Event;

  beforeEach(() => {
    listSpy = jest.fn(() => of({ data: templates, meta: { page: 1, pageSize: 100, total: 3 } }));
    updateSpy = jest.fn((id: string, dto: { sendEnabled?: boolean }) =>
      of({ ...templates.find((t) => t.id === id), sendEnabled: dto.sendEnabled }),
    );
    settingsGetSpy = jest.fn(() => of({ notifications: { pauseAll: false } }));
    settingsUpdateSpy = jest.fn((dto: { pauseAll?: boolean }) =>
      of({ notifications: { pauseAll: dto.pauseAll } }),
    );
  });

  it('loads rows and groups them by domain', () => {
    configure();
    expect(page.rows()).toHaveLength(3);
    const keys = page.groups().map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(['orders', 'giftcards', 'lifecycle']));
  });

  it('files the operational digests under Ops & Support, not Account & Auth', () => {
    // Finding E17: the `admin.` prefix swallowed both digests into the account
    // bucket; only the staff invite belongs there.
    listSpy = jest.fn(() =>
      of({
        data: [
          digest('t-kpi', 'admin.kpi-digest'),
          digest('t-ops', 'admin.ops-digest'),
          digest('t-invite', 'admin.staff-invite'),
        ],
        meta: { page: 1, pageSize: 100, total: 3 },
      }),
    );
    configure();
    const byKey = new Map(page.groups().map((g) => [g.key, g.rows.map((r) => r.code)]));
    expect(byKey.get('ops')).toEqual(
      expect.arrayContaining(['admin.kpi-digest', 'admin.ops-digest']),
    );
    expect(byKey.get('auth')).toEqual(['admin.staff-invite']);
  });

  it('toggling a non-locked flow calls updateTemplate and flips the row', () => {
    configure();
    page.toggleSend(templates[2], evt(true)); // cart.abandoned currently off → on
    expect(updateSpy).toHaveBeenCalledWith('t-cart', { sendEnabled: true });
    expect(page.rows().find((r) => r.id === 't-cart')?.sendEnabled).toBe(true);
  });

  it('reverts the optimistic flip when the update fails', () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL', message: 'boom', status: 500 })),
    );
    configure();
    page.toggleSend(templates[1], evt(false)); // giftcard on → off (fails)
    expect(page.rows().find((r) => r.id === 't-gift')?.sendEnabled).toBe(true); // reverted
    expect(page.error()).toBe('boom');
  });

  it('renders a read-only "Always on" cell for locked flows (no toggle)', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="templates-toggle-t-order"]')).toBeNull();
    expect(el.querySelector('[data-testid="templates-locked-t-order"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="templates-toggle-t-gift"]')).not.toBeNull();
  });

  it('toggling global pause calls settings.update and reflects the value', () => {
    configure();
    page.togglePause(evt(true));
    expect(settingsUpdateSpy).toHaveBeenCalledWith({ pauseAll: true });
    expect(page.pauseAll()).toBe(true);
  });

  it('reads the initial pause state from settings', () => {
    settingsGetSpy = jest.fn(() => of({ notifications: { pauseAll: true } }));
    configure();
    expect(page.pauseAll()).toBe(true);
  });

  it('does not mutate when the user lacks notifications:manage', () => {
    configure(['notifications:view']);
    expect(page.canManage()).toBe(false);
    page.toggleSend(templates[1], evt(false));
    expect(updateSpy).not.toHaveBeenCalled();
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
        () =>
          new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom upstream', status: 500 }),
      ),
    );
    configure();
    expect(page.error()).toBe('boom upstream');
  });

  it('a settings read failure does not blank the matrix', () => {
    settingsGetSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL', message: 'x', status: 500 })),
    );
    configure();
    expect(page.rows()).toHaveLength(3);
    expect(page.pauseAll()).toBe(false);
  });

  it('renders the empty state when no flows exist', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }));
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="templates-empty"]')).not.toBeNull();
  });

  it('reverts the pause toggle when the settings update fails', () => {
    settingsUpdateSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'INTERNAL', message: 'pause boom', status: 500 })),
    );
    configure();
    page.togglePause(evt(true));
    expect(page.pauseAll()).toBe(false); // reverted
    expect(page.error()).toBe('pause boom');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
