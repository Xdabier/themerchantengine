import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AttributesListPage } from './attributes-list.page';

expect.extend(toHaveNoViolations);

const productType = { id: 'pt-1', name: { default: 'Shoes' }, code: 'shoes' };
const attributes = [
  {
    id: 'a-1',
    productTypeId: 'pt-1',
    name: { default: 'Size' },
    code: 'size',
    sortOrder: 0,
    values: [{ id: 'v-1', value: { default: 'S' }, code: 'sz-s', sortOrder: 0 }],
  },
];

describe('AttributesListPage', () => {
  let fixture: ComponentFixture<AttributesListPage>;
  let page: AttributesListPage;
  let listAttrsSpy: jest.Mock;
  let listTypesSpy: jest.Mock;

  function configure(
    permissions: string[] = ['products:view'],
    queryParams: Record<string, string> = {},
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams), snapshot: {} } },
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ProductsService,
          useValue: {
            listAttributes: listAttrsSpy,
            listProductTypes: listTypesSpy,
            deleteAttribute: jest.fn(() => of(undefined)),
          },
        },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(AttributesListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listAttrsSpy = jest.fn(() =>
      of({ data: attributes, meta: { page: 1, pageSize: 20, total: 1 } }),
    );
    listTypesSpy = jest.fn(() =>
      of({ data: [productType], meta: { page: 1, pageSize: 100, total: 1 } }),
    );
  });

  it('shows the deep-linked product type on the filter select (QA C4 class)', () => {
    configure(['products:view'], { productTypeId: 'pt-1' });
    const select = fixture.nativeElement.querySelector(
      '[data-testid="attributes-filter-product-type"]',
    ) as HTMLSelectElement;
    // A value binding on the select is applied before its options exist, so the
    // browser silently falls back to the first option.
    expect(select.value).toBe('pt-1');
  });

  it('loads rows + product types', () => {
    configure();
    expect(page.rows()).toHaveLength(1);
    expect(page.productTypes()).toHaveLength(1);
  });

  it('productTypeLabelFor resolves to the type label', () => {
    configure();
    expect(page.productTypeLabelFor('pt-1')).toContain('Shoes');
    expect(page.productTypeLabelFor(null)).toBe('—');
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listAttrsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the attribute-not-found error', () => {
    listAttrsSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Attribute not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
