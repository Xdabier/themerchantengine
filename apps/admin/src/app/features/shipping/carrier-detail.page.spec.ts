import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, type ParamMap } from '@angular/router';
import { CarriersService } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CarrierDetailPage } from './carrier-detail.page';

expect.extend(toHaveNoViolations);

const carrierFixture = {
  id: 'car-1',
  code: 'dhl_express',
  name: { default: 'DHL Express', en: 'DHL Express' },
  provider: 'dhl' as const,
  services: ['express', 'economy'],
  zones: ['QA', 'AE'],
  isActive: true,
  sortOrder: 0,
  config: { apiKey: '***', accountId: '1234' },
};

describe('CarrierDetailPage', () => {
  let fixture: ComponentFixture<CarrierDetailPage>;
  let page: CarrierDetailPage;
  let getSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;
  let paramMap$: BehaviorSubject<ParamMap>;

  function configure(
    id = 'car-1',
    perms: string[] = ['carriers:view', 'carriers:update', 'carriers:delete'],
  ) {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: CarriersService,
          useValue: { get: getSpy, update: updateSpy, delete: deleteSpy },
        },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CarrierDetailPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    getSpy = jest.fn(() => of(carrierFixture));
    updateSpy = jest.fn((_id: string, body: Record<string, unknown>) =>
      of({ ...carrierFixture, ...body }),
    );
    deleteSpy = jest.fn(() => of(undefined));
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => confirmSpy.mockRestore());

  it('seeds form + config', () => {
    configure();
    expect(page.form.controls.zones.value).toBe('QA, AE');
    expect(page.configKeys()).toEqual(['accountId', 'apiKey']);
  });

  it('zonesError flags non-ISO codes', () => {
    configure();
    page.form.controls.zones.setValue('france');
    page.form.controls.zones.markAsTouched();
    expect(page.zonesError()).toContain('not a valid');
  });

  it('removeConfigKey stages a diff that nulls the deleted key on save', () => {
    configure();
    page.removeConfigKey('accountId');
    page.save();
    const body = updateSpy.mock.calls[0][1];
    expect(body.config.accountId).toBeNull();
  });

  it('addConfigKey + save ships the new key with its value', () => {
    configure();
    page.newKey.set('webhookUrl');
    page.addConfigKey();
    page.onConfigInput('webhookUrl', {
      target: { value: 'https://hook' },
    } as unknown as Event);
    page.save();
    const body = updateSpy.mock.calls[0][1];
    expect(body.config.webhookUrl).toBe('https://hook');
  });

  it('confirmDelete goes through openConfirmDialog', async () => {
    configure();
    await page.confirmDelete();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('car-1');
  });

  it('ApiNotFoundError surfaces a clear error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure('zzz');
    expect(page.error()).toBe('Carrier not found.');
  });

  it('ApiForbiddenError surfaces a permission error', () => {
    getSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure('zzz');
    expect(page.error()).toContain('permission');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
