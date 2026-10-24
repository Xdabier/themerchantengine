import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { CategoriesService, ProductsService, PromotionsService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { ApiConflictError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { provideCurrencyStoreStub } from '../../../testing/currency-store.mock';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';
import { PromotionDetailPage } from './promotion-detail.page';

expect.extend(toHaveNoViolations);

describe('PromotionDetailPage', () => {
  let fixture: ComponentFixture<PromotionDetailPage>;
  let page: PromotionDetailPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let deactivateSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;
  let paramMap$: BehaviorSubject<ParamMap>;

  const fixtureRow = {
    id: 'p1',
    name: { default: 'Spring Sale', en: 'Spring Sale' },
    type: 'PERCENTAGE',
    applicationMethod: 'COUPON',
    couponCode: 'SPRING',
    value: 15,
    usageLimit: 100,
    usageLimitPerUser: 1,
    isActive: true,
    isExclusive: false,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    eligibleProducts: [{ productId: 'prod1' }],
    eligibleCategories: [],
  };

  function configure(
    id = 'p1',
    perms: string[] = ['promotions:view', 'promotions:update', 'promotions:delete'],
  ) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: PromotionsService,
          useValue: { get: getSpy, update: updateSpy, deactivate: deactivateSpy },
        },
        { provide: CategoriesService, useValue: { tree: () => of([]) } },
        provideCurrencyStoreStub(),
        provideStoreSettingsStub(),
        {
          provide: ProductsService,
          useValue: {
            listProducts: () => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
            getProduct: (id: string) => of({ id, name: { default: id, en: id }, slug: id }),
          },
        },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(PromotionDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(fixtureRow));
    updateSpy = jest.fn((_id: string, body: Record<string, unknown>) =>
      of({ ...fixtureRow, ...body }),
    );
    deactivateSpy = jest.fn(() => of(undefined));
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('seeds the form from the loaded promotion', () => {
    configure();
    expect(page.form.controls.couponCode.value).toBe('SPRING');
    expect(page.form.controls.value.value).toBe(15);
    expect(page.form.controls.isActive.value).toBe(true);
  });

  it('scope() summarises eligibility counts', () => {
    configure();
    expect(page.scope(fixtureRow)).toContain('1 product');
  });

  it('save is a no-op when pristine', () => {
    configure();
    page.save();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('save PATCHes only dirty fields', () => {
    configure();
    page.form.controls.value.setValue(25);
    page.form.controls.value.markAsDirty();
    page.save();
    expect(updateSpy).toHaveBeenCalledWith('p1', { value: 25 });
  });

  it('save 409 maps to coupon conflict', () => {
    updateSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'COUPON_IN_USE', message: 'dup' })),
    );
    configure();
    page.form.controls.couponCode.setValue('TAKEN');
    page.form.controls.couponCode.markAsDirty();
    page.save();
    expect(page.error()).toContain('Coupon code conflict');
  });

  it('deactivate requires confirm + calls service.deactivate', async () => {
    configure();
    await page.confirmDeactivate();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deactivateSpy).toHaveBeenCalledWith('p1');
  });

  it('onScopeChanged flips scopeDirty when ids diverge', () => {
    configure();
    expect(page.scopeDirty()).toBe(false);
    page.onScopeChanged({ productIds: ['prod1', 'prod2'], categoryIds: [] });
    expect(page.scopeDirty()).toBe(true);
  });

  it('onScopeChanged keeps scopeDirty false when ids match initial (order-insensitive)', () => {
    configure();
    page.onScopeChanged({ productIds: ['prod1'], categoryIds: [] });
    expect(page.scopeDirty()).toBe(false);
  });

  it('save includes eligibleProductIds + eligibleCategoryIds only when scope is dirty', () => {
    configure();
    page.onScopeChanged({ productIds: ['prod1', 'newProd'], categoryIds: ['newCat'] });
    page.save();
    expect(updateSpy).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        eligibleProductIds: ['prod1', 'newProd'],
        eligibleCategoryIds: ['newCat'],
      }),
    );
  });

  it('not-found id surfaces a clear error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'x' })),
    );
    configure('zzz');
    expect(page.error()).toBe('Promotion not found.');
  });

  it('value control rejects a negative number via Validators.min(0)', () => {
    configure();
    page.form.controls.value.setValue(-5);
    page.form.controls.value.markAsTouched();
    expect(page.form.controls.value.invalid).toBe(true);
    expect(page.form.controls.value.errors?.['min']).toBeDefined();
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  /**
   * These four caps are optional, and the number input reports `null` for a
   * cleared field. They used to be held as strings and compared against `''`,
   * so a cleared cap read as `Number(null)`, which is 0, and 0 fails the
   * request schema's `positive()` inside a synchronous parse that escapes the
   * save handler after `busy` is already set: the Save button spins forever
   * and the operator loses the rest of their edits.
   */
  describe('optional caps', () => {
    it('omits a cleared usage cap rather than sending zero', () => {
      configure();
      page.form.controls.usageLimit.setValue(null);
      page.form.controls.usageLimit.markAsDirty();

      expect(() => page.save()).not.toThrow();

      expect(updateSpy).toHaveBeenCalled();
      const body = updateSpy.mock.calls[0][1] as Record<string, unknown>;
      expect('usageLimit' in body ? body['usageLimit'] : undefined).toBeUndefined();
    });

    it('omits every cleared cap, not only the first', () => {
      configure();
      for (const key of [
        'minimumOrderAmount',
        'maximumDiscount',
        'usageLimit',
        'usageLimitPerUser',
      ] as const) {
        page.form.controls[key].setValue(null);
        page.form.controls[key].markAsDirty();
      }

      expect(() => page.save()).not.toThrow();

      const body = updateSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(Object.values(body)).not.toContain(0);
    });

    it('sends a cap the operator actually set', () => {
      configure();
      page.form.controls.usageLimit.setValue(25);
      page.form.controls.usageLimit.markAsDirty();
      page.save();

      const body = updateSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(body['usageLimit']).toBe(25);
    });

    it('seeds a stored cap as a number and an absent one as null', () => {
      configure();

      expect(page.form.controls.usageLimit.value).toBe(100);
      expect(page.form.controls.minimumOrderAmount.value).toBeNull();
    });
  });

  /**
   * Both money fields on this screen, not one.
   *
   * `maximumDiscount` was missed when E3.4.3 rolled the affix out, and it was
   * missed again by two reviews and a brand audit, because nothing on this
   * screen asserted the affix on either field. A money input with no currency
   * indicator is what that ticket exists to remove.
   */
  it('names the currency on all three money fields, not only the first', () => {
    configure();
    const root = fixture.nativeElement as HTMLElement;

    const affixOf = (id: string): string =>
      root
        .querySelector(`#${id}`)
        ?.closest('app-input')
        ?.querySelector('[data-testid="input-prefix"], [data-testid="input-suffix"]')
        ?.textContent?.trim() ?? '';

    // The stub's symbol, not merely a non-empty string: truthiness passes on
    // whatever happens to render there. Named per field, because a loop
    // reports the first failure and hides the second, and the second is the
    // one that shipped without an affix.
    expect(affixOf('promo-min')).toBe('DT');
    expect(affixOf('promo-max')).toBe('DT');
    // The value field is the third one the source guard counts, and it is only
    // money for a fixed-amount promotion. The seeded promo is a percentage, so
    // it reads `%` here and the currency below.
    expect(affixOf('promo-value')).toBe('%');
  });

  it('names the currency on the value field once the promotion is a fixed amount', () => {
    getSpy = jest.fn(() => of({ ...fixtureRow, type: 'FIXED_AMOUNT' }));
    configure();
    const root = fixture.nativeElement as HTMLElement;
    const affix = root
      .querySelector('#promo-value')
      ?.closest('app-input')
      ?.querySelector('[data-testid="input-prefix"], [data-testid="input-suffix"]');

    expect(affix?.textContent?.trim()).toBe('DT');
  });
});
