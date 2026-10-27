import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GiftCardsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import {
  AdjustBalanceDialogComponent,
  type AdjustBalanceDialogData,
} from './adjust-balance-dialog.component';

expect.extend(toHaveNoViolations);

describe('AdjustBalanceDialogComponent', () => {
  let fixture: ComponentFixture<AdjustBalanceDialogComponent>;
  let page: AdjustBalanceDialogComponent;
  let closeSpy: jest.Mock;
  let adjustSpy: jest.Mock;

  const data: AdjustBalanceDialogData = {
    giftCardId: 'g1',
    currency: 'USD',
    currentBalance: 75,
  };

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { close: closeSpy } },
        { provide: GiftCardsService, useValue: { adjustBalance: adjustSpy } },
        provideCurrencyStoreStub(),
        provideStoreSettingsStub(),
      ],
    });
    fixture = TestBed.createComponent(AdjustBalanceDialogComponent);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    closeSpy = jest.fn();
    adjustSpy = jest.fn((_id: string, body: Record<string, unknown>) =>
      of({
        id: 'g1',
        code: 'GIFT-1',
        initialBalance: 100,
        currentBalance: 100,
        currency: 'USD',
        isActive: true,
        createdAt: new Date().toISOString(),
        ...body,
      }),
    );
  });

  it('rejects an empty reason', () => {
    configure();
    page.form.controls.amount.setValue(10);
    page.form.controls.reason.setValue('');
    page.form.controls.reason.markAsTouched();
    expect(page.reasonError()).toContain('required');
  });

  it('rejects zero amount with an inline error', () => {
    configure();
    page.form.controls.amount.setValue(0);
    page.form.controls.reason.setValue('Refund correction');
    page.submit();
    expect(page.error()).toContain('non-zero');
    expect(adjustSpy).not.toHaveBeenCalled();
  });

  it('submits valid credits + closes with saved kind', () => {
    configure();
    page.form.setValue({ amount: 25, reason: 'Promo bonus' });
    page.submit();
    expect(adjustSpy).toHaveBeenCalledWith('g1', { amount: 25, reason: 'Promo bonus' });
    expect(closeSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'saved' }));
  });

  it('surfaces ApiValidationError from the server', () => {
    adjustSpy = jest.fn(() =>
      throwError(
        () =>
          new ApiValidationError({
            code: 'VALIDATION_ERROR',
            message: 'Insufficient balance for this adjustment',
          }),
      ),
    );
    configure();
    page.form.setValue({ amount: -500, reason: 'Manual debit' });
    page.submit();
    expect(page.error()).toContain('Insufficient balance');
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('surfaces ApiForbiddenError as the permission error', () => {
    adjustSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.form.setValue({ amount: -500, reason: 'Manual debit' });
    page.submit();
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the gift-card-not-found error', () => {
    adjustSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.form.setValue({ amount: -500, reason: 'Manual debit' });
    page.submit();
    expect(page.error()).toContain('no longer exists');
  });

  it('cancel closes the dialog with null', () => {
    configure();
    page.cancel();
    expect(closeSpy).toHaveBeenCalledWith(null);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('names the card own currency on the amount field, not the store default', () => {
    // A card is written in the currency it was issued in and stays in it. The
    // store here is a DT store and the card is in USD, so a field adorned with
    // the store symbol would be telling the operator the wrong thing.
    configure();
    const affix = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="input-prefix"]',
    );

    expect(affix?.textContent?.trim()).toBe('USD');
  });
});
