import { ApiForbiddenError, ApiNotFoundError, ApiValidationError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AssetsService, ProductsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ProductCreatePage } from './product-create.page';

expect.extend(toHaveNoViolations);

const productType = { id: 'pt-1', name: { default: 'Shoes' }, code: 'shoes' };
const attribute = {
  id: 'a-1',
  productTypeId: 'pt-1',
  name: { default: 'Size' },
  code: 'size',
  values: [
    { id: 'v-1', value: { default: 'S' }, code: 'sz-s', sortOrder: 0 },
    { id: 'v-2', value: { default: 'M' }, code: 'sz-m', sortOrder: 1 },
  ],
};

describe('ProductCreatePage', () => {
  let fixture: ComponentFixture<ProductCreatePage>;
  let page: ProductCreatePage;
  let listTypesSpy: jest.Mock;
  let listAttrsSpy: jest.Mock;
  let createSpy: jest.Mock;
  let uploadSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: ProductsService,
          useValue: {
            listProductTypes: listTypesSpy,
            listAttributes: listAttrsSpy,
            createProduct: createSpy,
          },
        },
        { provide: AssetsService, useValue: { upload: uploadSpy } },
      ],
    });
    fixture = TestBed.createComponent(ProductCreatePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listTypesSpy = jest.fn(() =>
      of({ data: [productType], meta: { page: 1, pageSize: 100, total: 1 } }),
    );
    listAttrsSpy = jest.fn(() =>
      of({ data: [attribute], meta: { page: 1, pageSize: 100, total: 1 } }),
    );
    createSpy = jest.fn(() =>
      of({
        id: 'p-1',
        name: { default: 'New' },
        slug: 'new',
        status: 'DRAFT',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      }),
    );
    uploadSpy = jest.fn();
  });

  it('starts on step 0 with loadingTypes initially false after resolve', () => {
    configure();
    expect(page.step()).toBe(0);
    expect(page.productTypes()).toHaveLength(1);
  });

  it('canAdvance() returns false on step 0 until a product type is picked', () => {
    configure();
    expect(page.canAdvance()).toBe(false);
    page.selectProductType(productType);
    expect(page.canAdvance()).toBe(true);
  });

  it('selectProductType loads the type attributes', () => {
    configure();
    page.selectProductType(productType);
    expect(listAttrsSpy).toHaveBeenCalledWith({ productTypeId: 'pt-1', pageSize: 100 });
    expect(page.attributesForType()).toHaveLength(1);
  });

  it('addVariant + removeVariant adjust the form array', () => {
    configure();
    expect(page.variantsArray.length).toBe(1);
    page.addVariant();
    expect(page.variantsArray.length).toBe(2);
    page.removeVariant(1);
    expect(page.variantsArray.length).toBe(1);
  });

  it('submit sends the composed payload + routes to the new edit page', async () => {
    const navSpy = jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    configure();
    page.selectProductType(productType);
    page.form.controls.name.setValue({ default: 'New runner' });
    page.form.controls.slug.setValue('new-runner');
    const group = page.variantsArray.at(0);
    group.get('sku')?.setValue('RUN-1');
    group.get('price')?.setValue(149.99);
    page.submit();
    expect(createSpy).toHaveBeenCalled();
    const body = createSpy.mock.calls[0][0];
    expect(body.variants[0].isDefault).toBe(true);
    expect(body.variants[0].sku).toBe('RUN-1');
    expect(navSpy).toHaveBeenCalledWith(['/products', 'p-1', 'edit']);
  });

  /**
   * Categories were editable on the edit page only, so a product could not be
   * filed until after it existed. The create DTO already accepted
   * `categoryIds` and the API already wrote the join rows; only the control
   * was missing.
   */
  it('submit carries the picked categoryIds', () => {
    jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    configure();
    page.selectProductType(productType);
    page.form.controls.name.setValue({ default: 'New runner' });
    page.form.controls.slug.setValue('new-runner');
    const group = page.variantsArray.at(0);
    group.get('sku')?.setValue('RUN-1');
    group.get('price')?.setValue(149.99);
    page.onCategorySelectionChange(['cat-1', 'cat-2']);
    page.submit();
    expect(createSpy.mock.calls[0][0].categoryIds).toEqual(['cat-1', 'cat-2']);
  });

  it('submit omits categoryIds entirely when none are picked', () => {
    jest.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    configure();
    page.selectProductType(productType);
    page.form.controls.name.setValue({ default: 'New runner' });
    page.form.controls.slug.setValue('new-runner');
    const group = page.variantsArray.at(0);
    group.get('sku')?.setValue('RUN-1');
    group.get('price')?.setValue(149.99);
    page.submit();
    expect(createSpy.mock.calls[0][0]).not.toHaveProperty('categoryIds');
  });

  it('submit propagates ApiValidationError and pins to the owning step', () => {
    createSpy = jest.fn(() =>
      throwError(
        () =>
          new ApiValidationError({
            code: 'VALIDATION_ERROR',
            message: 'invalid',
            details: [{ path: ['slug'] }],
          }),
      ),
    );
    configure();
    page.selectProductType(productType);
    page.form.controls.name.setValue({ default: 'X' });
    page.form.controls.slug.setValue('ok-slug');
    page.variantsArray.at(0).get('sku')?.setValue('SKU');
    page.variantsArray.at(0).get('price')?.setValue(1);
    page.step.set(2);
    page.submit();
    expect(page.step()).toBe(1);
  });

  it('submit surfaces ApiForbiddenError as the permission-specific error', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    page.selectProductType(productType);
    page.form.controls.name.setValue({ default: 'X' });
    page.form.controls.slug.setValue('ok-slug');
    page.variantsArray.at(0).get('sku')?.setValue('SKU');
    page.variantsArray.at(0).get('price')?.setValue(1);
    page.submit();
    expect(page.error()).toContain('permission');
  });

  it('submit surfaces ApiNotFoundError as the product-not-found error', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    page.selectProductType(productType);
    page.form.controls.name.setValue({ default: 'X' });
    page.form.controls.slug.setValue('ok-slug');
    page.variantsArray.at(0).get('sku')?.setValue('SKU');
    page.variantsArray.at(0).get('price')?.setValue(1);
    page.submit();
    expect(page.error()).toBe('Product not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
