import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { GiftCardsService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { GiftCardDetailPage } from './gift-card-detail.page';

expect.extend(toHaveNoViolations);

const fixtureCard = {
  id: 'g1',
  code: 'GIFT-1234',
  initialBalance: 100,
  currentBalance: 75,
  currency: 'USD',
  isActive: true,
  recipientEmail: 'a@b.com',
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  transactions: [
    {
      id: 't1',
      amount: 100,
      note: 'Initial load',
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      id: 't2',
      amount: -25,
      note: 'Order redemption',
      createdAt: new Date().toISOString(),
    },
  ],
};

describe('GiftCardDetailPage', () => {
  let fixture: ComponentFixture<GiftCardDetailPage>;
  let page: GiftCardDetailPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let adjustSpy: jest.Mock;
  let resendSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;
  let paramMap$: BehaviorSubject<ParamMap>;

  function configure(id = 'g1', perms: string[] = ['gift_cards:view', 'gift_cards:update']) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: GiftCardsService,
          useValue: {
            get: getSpy,
            update: updateSpy,
            adjustBalance: adjustSpy,
            resendEmail: resendSpy,
          },
        },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(GiftCardDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixtureCard));
    updateSpy = jest.fn((_id: string, body: Record<string, unknown>) =>
      of({ ...fixtureCard, ...body }),
    );
    adjustSpy = jest.fn((_id: string, body: { amount: number }) =>
      of({
        ...fixtureCard,
        currentBalance: Number(fixtureCard.currentBalance) + body.amount,
      }),
    );
    resendSpy = jest.fn(() => of({ status: 'queued', recipientEmail: fixtureCard.recipientEmail }));
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('loads the card + renders transactions newest-first', () => {
    configure();
    expect(page.current()?.id).toBe('g1');
    const sorted = page.sortedTransactions();
    expect(sorted[0].id).toBe('t2');
    expect(sorted[1].id).toBe('t1');
  });

  it('deactivate requires confirm + sends isActive:false', async () => {
    configure();
    await page.deactivate();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('g1', { isActive: false });
  });

  it('reactivate requires confirm + sends isActive:true', async () => {
    configure();
    await page.reactivate();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('g1', { isActive: true });
  });

  it('cancel on confirm dialog skips the update', async () => {
    confirmSpy.mockResolvedValueOnce(false);
    configure();
    await page.deactivate();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('surfaces a permission error when deactivate PATCH returns 403', async () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    await page.deactivate();
    expect(page.error()).toContain('permission');
    expect(page.busy()).toBe(false);
    expect(page.action()).toBeNull();
  });

  it('surfaces a fallback error when reactivate PATCH fails with a generic ApiError', async () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiError({ code: 'SERVER_ERROR', message: 'upstream crash' })),
    );
    configure('g1', ['gift_cards:view', 'gift_cards:update']);
    await page.reactivate();
    expect(page.error()).toBe('upstream crash');
    expect(page.busy()).toBe(false);
    expect(page.action()).toBeNull();
  });

  it('canManage is false without the update permission', () => {
    configure('g1', ['gift_cards:view']);
    expect(page.canManage()).toBe(false);
  });

  it('ApiNotFoundError surfaces a clear error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure('zzz');
    expect(page.error()).toBe('Gift card not found.');
  });

  it('ApiForbiddenError surfaces a permission error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure('zzz');
    expect(page.error()).toContain('permission');
  });

  it('resend POSTs and flashes a success notice with the recipient email', (done) => {
    configure();
    page.resend();
    expect(resendSpy).toHaveBeenCalledWith('g1');
    // flashNotice runs synchronously in the subscribe `next`, so the signal
    // is populated before we check — then setTimeout clears it later.
    setTimeout(() => {
      expect(page.notice()).toContain(fixtureCard.recipientEmail);
      done();
    }, 0);
  });

  it('resend is a no-op when the card has no recipient email', () => {
    const cardWithoutEmail = { ...fixtureCard, recipientEmail: null };
    getSpy = jest.fn(() => of(cardWithoutEmail));
    configure();
    page.resend();
    expect(resendSpy).not.toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
