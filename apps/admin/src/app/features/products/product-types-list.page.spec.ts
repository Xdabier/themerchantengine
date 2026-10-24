import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProductsService, TaxService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ProductTypesListPage } from './product-types-list.page';

expect.extend(toHaveNoViolations);

const types = [
  {
    id: 'pt-1',
    name: { default: 'Shoes', en: 'Shoes' },
    code: 'shoes',
    taxClassId: null,
    attributeCount: 3,
  },
];

describe('ProductTypesListPage', () => {
  let fixture: ComponentFixture<ProductTypesListPage>;
  let page: ProductTypesListPage;
  let listSpy: jest.Mock;
  let listTaxSpy: jest.Mock;

  function configure(permissions: string[] = ['products:view', 'products:create']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ProductsService,
          useValue: {
            listProductTypes: listSpy,
            deleteProductType: jest.fn(() => of(undefined)),
          },
        },
        {
          provide: TaxService,
          useValue: { listClasses: listTaxSpy },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(ProductTypesListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of({ data: types, meta: { page: 1, pageSize: 20, total: 1 } }));
    listTaxSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 100, total: 0 } }));
  });

  it('loads rows + tax classes', () => {
    configure();
    expect(page.rows()).toHaveLength(1);
    expect(page.taxClasses()).toHaveLength(0);
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the product-type-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Product type not found.');
  });

  it('canCreate reflects the signed-in user permissions', () => {
    configure(['products:view']);
    expect(page.canCreate()).toBe(false);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
