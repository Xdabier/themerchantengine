import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificationTemplatesService } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { LogListPage } from './log-list.page';

// Avoid the admin-ui secondary bundle: the spec only needs the log-list page itself.
void adminUi;

expect.extend(toHaveNoViolations);

const logFixture = {
  id: 'log-1',
  templateId: 'tmpl-1',
  templateCode: 'order.shipped',
  channel: 'email' as const,
  recipient: 'a@b.com',
  status: 'sent' as const,
  sentAt: '2026-04-17T09:00:00.000Z',
};

describe('LogListPage', () => {
  let fixture: ComponentFixture<LogListPage>;
  let page: LogListPage;
  let listSpy: jest.Mock;
  let resendSpy: jest.Mock;

  function configure(perms: string[] = ['notifications:view', 'notifications:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: NotificationTemplatesService,
          useValue: { listLog: listSpy, resend: resendSpy },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(LogListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of({ data: [logFixture], meta: { page: 1, pageSize: 20, total: 1 } }));
    resendSpy = jest.fn(() => of({ status: 'queued', recipient: 'a@b.com' }));
  });

  it('loads rows', () => {
    configure();
    expect(page.rows()).toHaveLength(1);
  });

  it('resend calls service + surfaces a success notice', () => {
    configure();
    page.resend(logFixture);
    expect(resendSpy).toHaveBeenCalledWith('log-1');
    expect(page.notice()).toContain('a@b.com');
  });

  it('canResend is false for view-only perms', () => {
    configure(['notifications:view']);
    expect(page.canResend()).toBe(false);
  });

  it('403 on listLog surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('404 on resend surfaces a not-found error', () => {
    configure();
    resendSpy.mockReturnValueOnce(
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'x' })),
    );
    page.resend(logFixture);
    expect(page.error()).toBe('Log entry not found.');
  });

  it('403 on resend surfaces a permission-safe error', () => {
    configure();
    resendSpy.mockReturnValueOnce(
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    page.resend(logFixture);
    expect(page.error()).toContain('permission');
  });

  it('generic ApiError surfaces the typed message', () => {
    listSpy = jest.fn(() =>
      throwError(
        () =>
          new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom at provider', status: 500 }),
      ),
    );
    configure();
    expect(page.error()).toBe('boom at provider');
  });

  it('links a send-log row to its template when templateId is present', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    const link = el.querySelector(
      '[data-testid="log-template-link-log-1"]',
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toContain('/notifications/templates/tmpl-1');
  });

  it('renders plain template code (no link) when templateId is null', () => {
    listSpy = jest.fn(() =>
      of({
        data: [{ ...logFixture, templateId: null }],
        meta: { page: 1, pageSize: 20, total: 1 },
      }),
    );
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="log-template-link-log-1"]')).toBeNull();
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
