import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { SearchAdminService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { MerchandisingListPage } from './merchandising-list.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

const rule = {
  id: 'rule-1',
  type: 'BOOST' as const,
  query: 'shoe',
  productId: 'prod-1',
  position: null,
  priority: 5,
  config: null,
  isActive: true,
  createdAt: '2026-04-20T00:00:00.000Z',
  updatedAt: '2026-04-20T00:00:00.000Z',
};

describe('MerchandisingListPage', () => {
  let fixture: ComponentFixture<MerchandisingListPage>;
  let page: MerchandisingListPage;
  let listSpy: jest.Mock;
  let createSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let permissions: Set<string>;
  let dialogResult: boolean;

  function configure(params: Record<string, string> = {}) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: SearchAdminService,
          useValue: {
            listMerchandisingRules: listSpy,
            createMerchandisingRule: createSpy,
            deleteMerchandisingRule: deleteSpy,
          },
        },
        {
          provide: AuthStore,
          useValue: { hasPermission: (p: string) => permissions.has(p), locale: () => 'en' },
        },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
        {
          provide: Dialog,
          useValue: {
            open: jest.fn(() => ({ closed: of(dialogResult) })),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(MerchandisingListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = new Set(['products:update']);
    dialogResult = true;
    listSpy = jest.fn(() => of({ data: [rule], meta: { page: 1, pageSize: 20, total: 1 } }));
    createSpy = jest.fn(() => of(rule));
    deleteSpy = jest.fn(() => of(undefined));
  });

  it('renders one row per rule', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(`[data-testid="rule-row-${rule.id}"]`)).toBeTruthy();
  });

  it('form is invalid for BOOST without a productId', () => {
    configure();
    page.form.patchValue({ type: 'BOOST', productId: '' });
    expect(page.form.invalid).toBe(true);
    expect(page.form.errors?.['productIdRequired']).toBe(true);
  });

  it('form is invalid for PIN without a position', () => {
    configure();
    page.form.patchValue({ type: 'PIN', productId: 'prod-1', position: null });
    expect(page.form.invalid).toBe(true);
    expect(page.form.errors?.['positionRequired']).toBe(true);
  });

  it('form accepts REDIRECT without a productId', () => {
    configure();
    page.form.patchValue({ type: 'REDIRECT', productId: '', position: null, query: 'shoe' });
    expect(page.form.invalid).toBe(false);
  });

  it('submitCreate posts the BOOST payload and announces success', () => {
    configure();
    page.form.patchValue({ type: 'BOOST', productId: 'prod-1', query: 'shoe', priority: 5 });
    page.submitCreate();
    expect(createSpy).toHaveBeenCalledWith({
      type: 'BOOST',
      query: 'shoe',
      productId: 'prod-1',
      priority: 5,
    });
    expect(page.status()?.tone).toBe('success');
  });

  it('confirmDelete calls deleteMerchandisingRule when confirmed', async () => {
    configure();
    await page.confirmDelete(rule);
    expect(deleteSpy).toHaveBeenCalledWith(rule.id);
  });

  it('confirmDelete skips delete when cancelled', async () => {
    dialogResult = false;
    configure();
    await page.confirmDelete(rule);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('hides the create form when caller lacks products:update', () => {
    permissions = new Set();
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="rule-create-submit"]')).toBeNull();
  });

  it('surfaces a list error in the alert banner', () => {
    listSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    expect(page.error()).toBeTruthy();
  });

  it('is a11y-clean at the default mount', async () => {
    configure();
    const results = await axe(fixture.nativeElement as HTMLElement);
    expect(results).toHaveNoViolations();
  });
});
