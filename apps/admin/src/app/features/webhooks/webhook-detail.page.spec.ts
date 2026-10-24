import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ApiNotFoundError, ApiServerError } from '@admin-types';
import { WebhooksService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { WebhookDetailPage } from './webhook-detail.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

const sample = {
  id: 'wh-1',
  url: 'https://example.com/hook',
  events: ['order.created'],
  isActive: true,
  failureCount: 0,
  lastDeliveredAt: null,
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
};

const deliveryFixture = {
  data: [
    {
      id: 'd1',
      subscriptionId: 'wh-1',
      eventType: 'order.created' as const,
      eventId: 'e1',
      payload: { eventId: 'e1', eventType: 'order.created' },
      attempt: 1,
      responseStatus: 200,
      succeededAt: '2026-04-20T10:00:00.000Z',
      failedAt: null,
      nextRetryAt: null,
      createdAt: '2026-04-20T09:59:00.000Z',
    },
  ],
  meta: { page: 1, pageSize: 20, total: 1 },
};

describe('WebhookDetailPage', () => {
  let fixture: ComponentFixture<WebhookDetailPage>;
  let page: WebhookDetailPage;
  let getSpy: jest.Mock;
  let testSpy: jest.Mock;
  let removeSpy: jest.Mock;
  let deliveriesSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let permissions: Set<string>;

  function configure(getResponse: unknown = of(sample)) {
    queryParams$ = new BehaviorSubject<Record<string, string>>({});
    getSpy = jest.fn(() => getResponse);
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: WebhooksService,
          useValue: {
            get: getSpy,
            test: testSpy,
            remove: removeSpy,
            deliveries: deliveriesSpy,
          },
        },
        {
          provide: AuthStore,
          useValue: { locale: () => 'fr', hasPermission: (p: string) => permissions.has(p) },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: 'wh-1' })),
            queryParams: queryParams$.asObservable(),
            snapshot: { paramMap: convertToParamMap({ id: 'wh-1' }) },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(WebhookDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = new Set(['settings:view', 'settings:manage']);
    testSpy = jest.fn(() => of({ eventId: 'e1', deliveryId: 'd1' }));
    removeSpy = jest.fn(() => of(undefined));
    deliveriesSpy = jest.fn(() => of(deliveryFixture));
  });

  it('renders the detail page after loading', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="webhook-detail-page"]')).not.toBeNull();
    expect(getSpy).toHaveBeenCalledWith('wh-1');
  });

  it('shows not-found state when get returns 404', () => {
    configure(
      throwError(() => new ApiNotFoundError({ code: 'WEBHOOK_NOT_FOUND', message: 'gone' })),
    );
    expect(page.notFound()).toBe(true);
  });

  it('sendTest announces the queued delivery id', () => {
    configure();
    page.sendTest();
    expect(testSpy).toHaveBeenCalledWith('wh-1');
    expect(page.testStatus()).toMatch(/Test event queued/i);
  });

  it('sendTest reports a failure message when the API errors', () => {
    configure();
    testSpy.mockReturnValue(throwError(() => new ApiServerError({ code: 'X', message: 'down' })));
    page.sendTest();
    expect(page.testStatus()).toMatch(/failed|down/i);
  });

  it('confirmDelete navigates to /webhooks on success', async () => {
    configure();
    const router = TestBed.inject(Router);
    const nav = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    TestBed.inject(Dialog);
    // Override the dialog provider after module configuration is impossible — provide spy via configure() rewrite.
    page['dialog'] = {
      open: jest.fn(() => ({ closed: of(true) })),
    } as unknown as Dialog;
    await page.confirmDelete(sample);
    expect(removeSpy).toHaveBeenCalledWith('wh-1');
    expect(nav).toHaveBeenCalledWith(['/webhooks']);
  });

  it('hides the test button when settings:manage is missing', () => {
    permissions = new Set(['settings:view']);
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="webhook-test-button"]')).toBeNull();
  });

  it('renders deliveries table with one row from the fixture', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="delivery-row-d1"]')).not.toBeNull();
  });

  it('dismissSecret clears the revealed secret', () => {
    configure();
    page.revealedSecret.set('topsecret');
    page.dismissSecret();
    expect(page.revealedSecret()).toBeNull();
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
