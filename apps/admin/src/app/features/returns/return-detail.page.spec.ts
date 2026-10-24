import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { ReturnsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ReturnDetailPage } from './return-detail.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

describe('ReturnDetailPage', () => {
  let fixture: ComponentFixture<ReturnDetailPage>;
  let page: ReturnDetailPage;
  let getSpy: jest.Mock;
  let paramMap$: BehaviorSubject<{ get(k: string): string | null }>;

  const detailFixture = {
    id: 'return-1',
    returnNumber: 'RET-2026-0001',
    orderId: 'order-4',
    status: 'REQUESTED',
    reason: 'WRONG_SIZE',
    refundMethod: null,
    refundAmount: '349',
    createdAt: '2026-04-15T12:00:00.000Z',
    order: { orderNumber: 'ORD-2026-000004', currency: 'EUR' },
    customer: { id: 'c1', email: 'x@test', firstName: 'Sara', lastName: 'Hassan' },
    items: [
      {
        id: 'ri-1',
        orderItemId: 'oi-1',
        quantity: 1,
        restockDecision: 'RESTOCK',
        orderItem: { sku: 'SHOE-42', productName: 'Urban Runner Sneakers', unitPrice: '349' },
      },
    ],
  };

  function configure(permissionHeld = false) {
    paramMap$ = new BehaviorSubject<{ get(k: string): string | null }>({
      get: (k: string) => (k === 'id' ? 'return-1' : null),
    });
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ReturnsService,
          useValue: { get: getSpy, approve: jest.fn(), close: jest.fn() },
        },
        {
          provide: AuthStore,
          useValue: {
            hasPermission: (p: string) => permissionHeld && p === 'returns:update',
            locale: () => 'en',
          },
        },
        { provide: Dialog, useValue: { open: jest.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable(), queryParams: of({}) },
        },
      ],
    });
    fixture = TestBed.createComponent(ReturnDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('loads the return detail and hydrates the signal', () => {
    getSpy = jest.fn(() => of(detailFixture));
    configure();
    expect(getSpy).toHaveBeenCalledWith('return-1');
    expect(page.returnRecord()?.id).toBe('return-1');
    expect(page.loading()).toBe(false);
  });

  it('renders the order link back to the parent order', () => {
    getSpy = jest.fn(() => of(detailFixture));
    configure();
    const link = fixture.nativeElement.querySelector('[data-testid="return-order-link"]');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/orders/order-4');
  });

  it('maps ApiNotFoundError to a friendly not-found message', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toContain('not found');
  });

  it('maps ApiForbiddenError to the permission-specific error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('hides the action panel for viewers without returns:update', () => {
    getSpy = jest.fn(() => of(detailFixture));
    configure(false);
    const actions = fixture.nativeElement.querySelector('[data-testid="return-actions"]');
    expect(actions).toBeNull();
  });

  it('shows the action panel when the viewer holds returns:update', () => {
    getSpy = jest.fn(() => of(detailFixture));
    configure(true);
    const actions = fixture.nativeElement.querySelector('[data-testid="return-actions"]');
    expect(actions).not.toBeNull();
  });

  // ── Plan F, finding F11 ────────────────────────────────────────────────

  it('flags a milestone recorded before an earlier stage', () => {
    getSpy = jest.fn(() =>
      of({
        ...detailFixture,
        status: 'REFUND_PROCESSED',
        requestedAt: '2026-05-24T09:00:00.000Z',
        approvedAt: '2026-03-29T10:00:00.000Z',
        receivedAt: '2026-03-31T12:00:00.000Z',
        refundedAt: '2026-04-01T09:00:00.000Z',
      }),
    );
    configure();

    const approved = fixture.nativeElement.querySelector(
      '[data-testid="return-timeline-approved"]',
    ) as HTMLElement;
    expect(approved.textContent).toContain('Out of order');
    expect(approved.textContent).toContain('timestamped before an earlier stage');

    // Rendered top to bottom in the order things actually happened.
    const stages = [
      ...fixture.nativeElement.querySelectorAll('[data-testid^="return-timeline-"]'),
    ].map((el: Element) => el.getAttribute('data-testid'));
    expect(stages).toEqual([
      'return-timeline-approved',
      'return-timeline-received',
      'return-timeline-refunded',
      'return-timeline-requested',
    ]);
  });

  it('flags nothing when the timeline is chronological', () => {
    getSpy = jest.fn(() =>
      of({
        ...detailFixture,
        requestedAt: '2026-03-24T09:00:00.000Z',
        approvedAt: '2026-03-29T10:00:00.000Z',
      }),
    );
    configure();

    const timeline = fixture.nativeElement.querySelector(
      '[data-testid="return-timeline"]',
    ) as HTMLElement;
    expect(timeline.textContent).not.toContain('Out of order');
  });

  it('has no axe violations on the hydrated detail', async () => {
    getSpy = jest.fn(() => of(detailFixture));
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the manager view with actions rendered', async () => {
    getSpy = jest.fn(() => of(detailFixture));
    configure(true);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
