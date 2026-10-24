import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { ProductsService } from './products.service';

const productFixture = {
  id: 'd4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd',
  name: { default: 'Test Product', en: 'Test Product' },
  slug: 'test-product',
  status: 'DRAFT',
  createdAt: '2026-04-15T10:00:00.000Z',
  updatedAt: '2026-04-15T10:00:00.000Z',
};

const productTypeFixture = {
  id: 'e4f5c9a4-1a1a-4a4a-8a8a-eeeeeeeeeeee',
  name: { default: 'Shoes' },
  code: 'shoes',
};

const attributeFixture = {
  id: 'f4f5c9a4-1a1a-4a4a-8a8a-ffffffffffff',
  productTypeId: 'e4f5c9a4-1a1a-4a4a-8a8a-eeeeeeeeeeee',
  name: { default: 'Size' },
  code: 'size',
  sortOrder: 0,
};

const variantFixture = {
  id: '04f5c9a4-1a1a-4a4a-8a8a-000000000000',
  productId: 'd4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd',
  sku: 'SKU-001',
  price: 100,
  isDefault: true,
  isActive: true,
};

describe('ProductsService', () => {
  let service: ProductsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        ProductsService,
      ],
    });
    service = TestBed.inject(ProductsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /* Product types */

  it('listProductTypes() hits /admin/product-types with pagination', (done) => {
    service.listProductTypes({ page: 1, pageSize: 20 }).subscribe((res) => {
      expect(res.data).toHaveLength(1);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/product-types');
    expect(req.request.params.get('page')).toBe('1');
    req.flush({ data: [productTypeFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('createProductType() validates the kebab-case code regex', () => {
    expect(() =>
      service.createProductType({ name: { default: 'X' }, code: 'Bad Code!' }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/product-types');
  });

  it('createProductType() POSTs + unwraps the envelope on happy path', (done) => {
    service.createProductType({ name: { default: 'Shoes' }, code: 'shoes' }).subscribe((pt) => {
      expect(pt.id).toBe(productTypeFixture.id);
      done();
    });
    const req = http.expectOne('/api/v1/admin/product-types');
    expect(req.request.method).toBe('POST');
    req.flush({ data: productTypeFixture });
  });

  it('updateProductType() PATCHes a partial payload', (done) => {
    service
      .updateProductType(productTypeFixture.id, { name: { default: 'Footwear' } })
      .subscribe((pt) => {
        expect(pt.code).toBe('shoes');
        done();
      });
    const req = http.expectOne(`/api/v1/admin/product-types/${productTypeFixture.id}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: productTypeFixture });
  });

  it('deleteProductType() DELETEs and resolves void', (done) => {
    service.deleteProductType(productTypeFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/product-types/${productTypeFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('deleteProductType() propagates 409 when products still use the type', (done) => {
    service.deleteProductType(productTypeFixture.id).subscribe({
      next: () => done(new Error('should not succeed')),
      error: (err) => {
        expect(err.status).toBe(409);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/product-types/${productTypeFixture.id}`);
    req.flush(
      { error: { code: 'IN_USE', message: 'products use this type' } },
      { status: 409, statusText: 'Conflict' },
    );
  });

  /* Bulk */

  it('bulkUpdatePrices() PATCHes /products/bulk/prices with the forwarded body', (done) => {
    service
      .bulkUpdatePrices({
        items: [{ variantId: '04f5c9a4-1a1a-4a4a-8a8a-000000000000', price: 99.99 }],
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/products/bulk/prices');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.items).toHaveLength(1);
    expect(req.request.body.items[0].variantId).toBe('04f5c9a4-1a1a-4a4a-8a8a-000000000000');
    expect(req.request.body.items[0].price).toBe(99.99);
    req.flush(null);
  });

  it('bulkUpdatePrices() rejects an empty items array via Zod', () => {
    expect(() => service.bulkUpdatePrices({ items: [] as never }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/products/bulk/prices');
  });

  it('bulkUpdatePrices() rejects a negative price via the money nonnegative refine', () => {
    expect(() =>
      service
        .bulkUpdatePrices({
          items: [{ variantId: '04f5c9a4-1a1a-4a4a-8a8a-000000000000', price: -1 }],
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/products/bulk/prices');
  });

  it('bulkUpdatePrices() accepts a millime price and rejects a fourth decimal', () => {
    // Inverts rather than shifts. XTS is a three-decimal currency, so 9.999 DT
    // is a legal amount the previous contract rejected before the request ever
    // left the browser. The gate moves to the fourth digit; it does not go away.
    service
      .bulkUpdatePrices({
        items: [{ variantId: '04f5c9a4-1a1a-4a4a-8a8a-000000000000', price: 9.999 }],
      })
      .subscribe();
    http.expectOne('/api/v1/admin/products/bulk/prices').flush({ data: { count: 1 } });

    expect(() =>
      service
        .bulkUpdatePrices({
          items: [{ variantId: '04f5c9a4-1a1a-4a4a-8a8a-000000000000', price: 9.9999 }],
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/products/bulk/prices');
  });

  it('bulkUpdatePrices() rejects a malformed variantId via entityIdSchema', () => {
    expect(() =>
      service.bulkUpdatePrices({ items: [{ variantId: 'not a uuid!', price: 10 }] }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/products/bulk/prices');
  });

  it('bulkUpdatePrices() propagates a backend 403 to the observer error callback', (done) => {
    service
      .bulkUpdatePrices({
        items: [{ variantId: '04f5c9a4-1a1a-4a4a-8a8a-000000000000', price: 50 }],
      })
      .subscribe({
        next: () => done(new Error('should not succeed')),
        error: (err) => {
          expect(err.status).toBe(403);
          done();
        },
      });
    const req = http.expectOne('/api/v1/admin/products/bulk/prices');
    req.flush(
      { error: { code: 'FORBIDDEN', message: 'insufficient permissions' } },
      { status: 403, statusText: 'Forbidden' },
    );
  });

  it('bulkUpdateStatus() PATCHes /products/bulk/status with the forwarded body', (done) => {
    service
      .bulkUpdateStatus({
        productIds: ['d4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd'],
        status: 'ACTIVE',
      })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/products/bulk/status');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.productIds).toEqual(['d4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd']);
    expect(req.request.body.status).toBe('ACTIVE');
    req.flush(null);
  });

  it('bulkUpdateStatus() rejects empty productIds via Zod', () => {
    expect(() =>
      service.bulkUpdateStatus({ productIds: [], status: 'ACTIVE' } as never).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/products/bulk/status');
  });

  it('bulkUpdateStatus() rejects an invalid status value via productStatusSchema', () => {
    expect(() =>
      service
        .bulkUpdateStatus({
          productIds: ['d4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd'],
          status: 'PUBLISHED',
        } as never)
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/products/bulk/status');
  });

  it('bulkUpdateStatus() rejects a malformed productId via entityIdSchema', () => {
    expect(() =>
      service.bulkUpdateStatus({ productIds: ['not a uuid!'], status: 'ACTIVE' }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/products/bulk/status');
  });

  it('bulkUpdateStatus() propagates a backend 500 to the observer error callback', (done) => {
    service
      .bulkUpdateStatus({
        productIds: ['d4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd'],
        status: 'ARCHIVED',
      })
      .subscribe({
        next: () => done(new Error('should not succeed')),
        error: (err) => {
          expect(err.status).toBe(500);
          done();
        },
      });
    const req = http.expectOne('/api/v1/admin/products/bulk/status');
    req.flush(
      { error: { code: 'INTERNAL_SERVER_ERROR', message: 'unexpected' } },
      { status: 500, statusText: 'Internal Server Error' },
    );
  });

  /* Products */

  it('listProducts() filters + pagination round-trips', (done) => {
    service
      .listProducts({ status: 'ACTIVE', page: 2, pageSize: 10, search: 'shoe' })
      .subscribe((res) => {
        expect(res.data).toHaveLength(1);
        expect(res.meta.page).toBe(2);
        done();
      });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/products');
    expect(req.request.params.get('status')).toBe('ACTIVE');
    expect(req.request.params.get('search')).toBe('shoe');
    req.flush({ data: [productFixture], meta: { page: 2, pageSize: 10, total: 1 } });
  });

  it('createProduct() accepts a Translatable-named product', (done) => {
    service
      .createProduct({ name: { default: 'Nouveau', fr: 'Nouveau', en: 'New' } })
      .subscribe((p) => {
        expect(p.id).toBe(productFixture.id);
        done();
      });
    const req = http.expectOne('/api/v1/admin/products');
    expect(req.request.method).toBe('POST');
    req.flush({ data: productFixture });
  });

  it('createProduct() rejects a bad slug via the regex validator', () => {
    expect(() =>
      service.createProduct({ name: { default: 'X' }, slug: 'Not A Slug' }).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/products');
  });

  it('getProduct() unwraps the envelope', (done) => {
    service.getProduct(productFixture.id).subscribe((p) => {
      expect(p.slug).toBe('test-product');
      done();
    });
    http.expectOne(`/api/v1/admin/products/${productFixture.id}`).flush({ data: productFixture });
  });

  it('deleteProduct() DELETEs for soft-delete semantics', (done) => {
    service.deleteProduct(productFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('restoreProduct() PATCHes /restore', (done) => {
    service.restoreProduct(productFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/restore`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: productFixture });
  });

  it('restoreProduct() returns a Product with deletedAt null and status DRAFT', (done) => {
    service.restoreProduct(productFixture.id).subscribe((p) => {
      expect(p.deletedAt).toBeNull();
      expect(p.status).toBe('DRAFT');
      expect(p.id).toBe(productFixture.id);
      done();
    });
    http
      .expectOne(`/api/v1/admin/products/${productFixture.id}/restore`)
      .flush({ data: { ...productFixture, status: 'DRAFT', deletedAt: null } });
  });

  it('restoreProduct() surfaces a backend 403 to the observer', (done) => {
    service.restoreProduct(productFixture.id).subscribe({
      error: (err) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/products/${productFixture.id}/restore`)
      .flush({ error: { code: 'FORBIDDEN' } }, { status: 403, statusText: 'Forbidden' });
  });

  it('restoreProduct() surfaces a backend 404 for a non-existent product', (done) => {
    service.restoreProduct('missing-id').subscribe({
      error: (err) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/products/missing-id/restore`)
      .flush({ error: { code: 'NOT_FOUND' } }, { status: 404, statusText: 'Not Found' });
  });

  it('restoreProduct() throws a ZodError when the response envelope is malformed', (done) => {
    service.restoreProduct(productFixture.id).subscribe({
      error: (err) => {
        expect(err.name).toBe('ZodError');
        done();
      },
    });
    http
      .expectOne(`/api/v1/admin/products/${productFixture.id}/restore`)
      .flush({ data: { id: 'bad', createdAt: 'not-a-date' } });
  });

  /* Variants */

  it('createVariant() posts under the product id', (done) => {
    service.createVariant(productFixture.id, { sku: 'SKU-002', price: 50.5 }).subscribe((v) => {
      expect(v.sku).toBe('SKU-001');
      done();
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/variants`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: variantFixture });
  });

  it('createVariant() accepts a millime price and rejects a fourth decimal', () => {
    service.createVariant(productFixture.id, { sku: 'S', price: 9.999 }).subscribe();
    http
      .expectOne(`/api/v1/admin/products/${productFixture.id}/variants`)
      .flush({ data: variantFixture });

    expect(() =>
      service.createVariant(productFixture.id, { sku: 'S', price: 9.9999 }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/products/${productFixture.id}/variants`);
  });

  /* Attributes */

  it('listAttributes() forwards productTypeId filter', (done) => {
    service.listAttributes({ productTypeId: productTypeFixture.id, page: 1 }).subscribe((res) => {
      expect(res.data).toHaveLength(1);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/attributes');
    expect(req.request.params.get('productTypeId')).toBe(productTypeFixture.id);
    req.flush({ data: [attributeFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('createAttribute() POSTs with the required productTypeId + code', (done) => {
    service
      .createAttribute({
        productTypeId: productTypeFixture.id,
        name: { default: 'Size' },
        code: 'size',
      })
      .subscribe((a) => {
        expect(a.id).toBe(attributeFixture.id);
        done();
      });
    const req = http.expectOne('/api/v1/admin/attributes');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.productTypeId).toBe(productTypeFixture.id);
    req.flush({ data: attributeFixture });
  });

  it('createAttribute() rejects when productTypeId is missing', () => {
    expect(() =>
      service.createAttribute({ name: { default: 'X' }, code: 'size' } as never).subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/attributes');
  });

  it('createAttribute() rejects a code with uppercase / spaces', () => {
    expect(() =>
      service
        .createAttribute({
          productTypeId: productTypeFixture.id,
          name: { default: 'X' },
          code: 'Bad Code',
        })
        .subscribe(),
    ).toThrow();
    http.expectNone('/api/v1/admin/attributes');
  });

  it('updateAttribute() PATCHes a partial payload', (done) => {
    service
      .updateAttribute(attributeFixture.id, { name: { default: 'Dimension' } })
      .subscribe((a) => {
        expect(a.code).toBe('size');
        done();
      });
    const req = http.expectOne(`/api/v1/admin/attributes/${attributeFixture.id}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: attributeFixture });
  });

  it('deleteAttribute() DELETEs and resolves void', (done) => {
    service.deleteAttribute(attributeFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/attributes/${attributeFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('deleteAttribute() propagates 409 when variants still use any value', (done) => {
    service.deleteAttribute(attributeFixture.id).subscribe({
      next: () => done(new Error('should not succeed')),
      error: (err) => {
        expect(err.status).toBe(409);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/attributes/${attributeFixture.id}`);
    req.flush(
      { error: { code: 'IN_USE', message: 'variants use values from this attribute' } },
      { status: 409, statusText: 'Conflict' },
    );
  });

  it('createAttributeValue() POSTs under the attribute id', (done) => {
    service
      .createAttributeValue(attributeFixture.id, { value: { default: '42' }, code: 'sz-42' })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/attributes/${attributeFixture.id}/values`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: attributeFixture });
  });

  it('createAttributeValue() rejects an invalid code regex', () => {
    expect(() =>
      service
        .createAttributeValue(attributeFixture.id, {
          value: { default: 'X' },
          code: 'INVALID CODE',
        })
        .subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/attributes/${attributeFixture.id}/values`);
  });

  it('updateAttributeValue() PATCHes under attribute/:id/values/:valueId', (done) => {
    const valueId = '24f5c9a4-1a1a-4a4a-8a8a-222222222222';
    service
      .updateAttributeValue(attributeFixture.id, valueId, { sortOrder: 3 })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/attributes/${attributeFixture.id}/values/${valueId}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: attributeFixture });
  });

  it('deleteAttributeValue() DELETEs and resolves void', (done) => {
    const valueId = '24f5c9a4-1a1a-4a4a-8a8a-222222222222';
    service.deleteAttributeValue(attributeFixture.id, valueId).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/attributes/${attributeFixture.id}/values/${valueId}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('deleteAttributeValue() propagates 409 when variants still use the value', (done) => {
    const valueId = '24f5c9a4-1a1a-4a4a-8a8a-222222222222';
    service.deleteAttributeValue(attributeFixture.id, valueId).subscribe({
      next: () => done(new Error('should not succeed')),
      error: (err) => {
        expect(err.status).toBe(409);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/attributes/${attributeFixture.id}/values/${valueId}`);
    req.flush(
      { error: { code: 'IN_USE', message: 'variants use this value' } },
      { status: 409, statusText: 'Conflict' },
    );
  });

  it('createProduct() sends nested variants with attributeValueIds', (done) => {
    const valueId = '24f5c9a4-1a1a-4a4a-8a8a-222222222222';
    service
      .createProduct({
        name: { default: 'Runner Shoe' },
        productTypeId: productTypeFixture.id,
        variants: [
          {
            sku: 'RUN-42',
            price: 199.99,
            isDefault: true,
            attributeValueIds: [valueId],
          },
        ],
      })
      .subscribe((p) => {
        expect(p.id).toBe(productFixture.id);
        done();
      });
    const req = http.expectOne('/api/v1/admin/products');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.variants[0].attributeValueIds).toEqual([valueId]);
    req.flush({ data: productFixture });
  });

  /* Assets + FAQs */

  it('updateProductAssets() rejects an empty assets array', () => {
    expect(() =>
      service.updateProductAssets(productFixture.id, { assets: [] as never }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/products/${productFixture.id}/assets`);
  });

  it('createFaq() POSTs under the product id', (done) => {
    service
      .createFaq(productFixture.id, {
        question: { default: 'Q?' },
        answer: { default: 'A.' },
      })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/faqs`);
    expect(req.request.method).toBe('POST');
    req.flush({
      data: {
        id: '14f5c9a4-1a1a-4a4a-8a8a-111111111111',
        question: { default: 'Q?' },
        answer: { default: 'A.' },
      },
    });
  });

  it('createFaq() rejects malformed backend response via Zod', (done) => {
    service
      .createFaq(productFixture.id, {
        question: { default: 'Q?' },
        answer: { default: 'A.' },
      })
      .subscribe({
        next: () => done.fail('expected ZodError'),
        error: (err) => {
          expect(err).toBeTruthy();
          done();
        },
      });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/faqs`);
    req.flush({ data: { id: '14f5c9a4-1a1a-4a4a-8a8a-111111111111' } });
  });

  it('updateFaq() PATCHes the faq row', (done) => {
    const faqId = '14f5c9a4-1a1a-4a4a-8a8a-111111111111';
    service
      .updateFaq(productFixture.id, faqId, { answer: { default: 'New answer.' } })
      .subscribe((faq) => {
        expect(faq.id).toBe(faqId);
        done();
      });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/faqs/${faqId}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({
      data: {
        id: faqId,
        productId: productFixture.id,
        question: { default: 'Q?' },
        answer: { default: 'New answer.' },
        sortOrder: 0,
      },
    });
  });

  it('updateFaq() propagates 404 error', (done) => {
    const faqId = '14f5c9a4-1a1a-4a4a-8a8a-111111111111';
    service.updateFaq(productFixture.id, faqId, { answer: { default: 'A.' } }).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(404);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/faqs/${faqId}`);
    req.flush(
      { error: { code: 'NOT_FOUND', message: 'FAQ not found' } },
      {
        status: 404,
        statusText: 'Not Found',
      },
    );
  });

  it('deleteFaq() DELETEs and resolves void', (done) => {
    const faqId = '14f5c9a4-1a1a-4a4a-8a8a-111111111111';
    service.deleteFaq(productFixture.id, faqId).subscribe((res) => {
      expect(res).toBeUndefined();
      done();
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/faqs/${faqId}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('deleteFaq() propagates 403 error', (done) => {
    const faqId = '14f5c9a4-1a1a-4a4a-8a8a-111111111111';
    service.deleteFaq(productFixture.id, faqId).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/faqs/${faqId}`);
    req.flush(
      { error: { code: 'FORBIDDEN', message: 'no' } },
      {
        status: 403,
        statusText: 'Forbidden',
      },
    );
  });

  it('getProduct() surfaces faqs from the include payload', (done) => {
    service.getProduct(productFixture.id).subscribe((p) => {
      expect(p.faqs).toHaveLength(1);
      expect(p.faqs![0].question.default).toBe('Q?');
      done();
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}`);
    req.flush({
      data: {
        ...productFixture,
        faqs: [
          {
            id: '24f5c9a4-1a1a-4a4a-8a8a-222222222222',
            productId: productFixture.id,
            question: { default: 'Q?' },
            answer: { default: 'A.' },
            sortOrder: 0,
          },
        ],
      },
    });
  });

  /**
   * The API include carries `categories` (products.service.ts:800) but
   * `productSchema` omitted the key, and a zod object strips what it does not
   * declare. The edit page then seeded an empty selection, so nothing
   * pre-checked and the first toggle-then-save PATCHed `categoryIds` with only
   * the re-ticked ids, silently detaching every category the product had.
   */
  describe('specifications', () => {
    const specRow = {
      id: '54f5c9a4-1a1a-4a4a-8a8a-555555555555',
      productId: productFixture.id,
      label: { default: 'Materiau', fr: 'Materiau', en: 'Material' },
      value: { default: 'Acier', fr: 'Acier', en: 'Steel' },
      key: 'materiau',
      valueKey: 'acier',
      sortOrder: 0,
    };

    /** DR-25 step 4: specs pin the resolved URL, never the route constant. */
    it('replaceSpecs() PUTs the literal /api/v1/admin/products/:id/specs', (done) => {
      service
        .replaceSpecs(productFixture.id, {
          specs: [{ label: { default: 'Materiau' }, value: { default: 'Acier' } }],
        })
        .subscribe((rows) => {
          expect(rows).toHaveLength(1);
          expect(rows[0].key).toBe('materiau');
          done();
        });
      const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/specs`);
      expect(req.request.method).toBe('PUT');
      req.flush({ data: [specRow] });
    });

    it('replaceSpecs() sends only label and value, never the derived fields', (done) => {
      service
        .replaceSpecs(productFixture.id, {
          specs: [{ label: { default: 'Materiau' }, value: { default: 'Acier' } }],
        })
        .subscribe(() => done());
      const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/specs`);
      const body = req.request.body as { specs: Array<Record<string, unknown>> };
      expect(Object.keys(body.specs[0]).sort()).toEqual(['label', 'value']);
      req.flush({ data: [specRow] });
    });

    it('replaceSpecs() sends an empty array as the clear-all', (done) => {
      service.replaceSpecs(productFixture.id, { specs: [] }).subscribe(() => done());
      const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}/specs`);
      expect(req.request.body).toEqual({ specs: [] });
      req.flush({ data: [] });
    });

    /**
     * The parse throws synchronously, before any request is made, so a caller
     * that relies on the observable's error channel alone never sees it.
     */
    it('replaceSpecs() rejects an over-cap array without issuing a request', () => {
      const tooMany = Array.from({ length: 51 }, (_, i) => ({
        label: { default: `L${i}` },
        value: { default: 'v' },
      }));
      expect(() => service.replaceSpecs(productFixture.id, { specs: tooMany })).toThrow();
      http.expectNone(`/api/v1/admin/products/${productFixture.id}/specs`);
    });

    it('replaceSpecs() rejects a label with no default without issuing a request', () => {
      expect(() =>
        service.replaceSpecs(productFixture.id, {
          specs: [{ label: { en: 'Material' } as never, value: { default: 'Acier' } }],
        }),
      ).toThrow();
      http.expectNone(`/api/v1/admin/products/${productFixture.id}/specs`);
    });

    it('listSpecLabels() GETs the literal /api/v1/admin/product-specs/labels', (done) => {
      service.listSpecLabels({ search: 'mat' }).subscribe((res) => {
        expect(res.data[0].key).toBe('materiau');
        expect(res.data[0].productCount).toBe(7);
        done();
      });
      const req = http.expectOne(
        (r) => r.url === '/api/v1/admin/product-specs/labels' && r.params.get('search') === 'mat',
      );
      expect(req.request.method).toBe('GET');
      req.flush({
        data: [{ key: 'materiau', label: { default: 'Materiau' }, productCount: 7 }],
        meta: { page: 1, pageSize: 20, total: 1 },
      });
    });

    it('listSpecLabels() omits an empty search rather than sending a blank param', (done) => {
      service.listSpecLabels({}).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/product-specs/labels');
      expect(req.request.params.has('search')).toBe(false);
      req.flush({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
    });

    /**
     * The server resolves a representative spelling in a second query, so a key
     * whose row vanished between the two reads comes back with a null label.
     * That must not fail the whole parse and blank the picker.
     */
    it('listSpecLabels() accepts an option whose label could not be resolved', (done) => {
      service.listSpecLabels({}).subscribe((res) => {
        expect(res.data[0].label).toBeNull();
        done();
      });
      http
        .expectOne((r) => r.url === '/api/v1/admin/product-specs/labels')
        .flush({
          data: [{ key: 'orphan', label: null, productCount: 1 }],
          meta: { page: 1, pageSize: 20, total: 1 },
        });
    });

    it('getProduct() surfaces specs from the include payload', (done) => {
      service.getProduct(productFixture.id).subscribe((p) => {
        expect(p.specs).toHaveLength(1);
        expect(p.specs![0].label.default).toBe('Materiau');
        expect(p.specs![0].sortOrder).toBe(0);
        done();
      });
      http
        .expectOne(`/api/v1/admin/products/${productFixture.id}`)
        .flush({ data: { ...productFixture, specs: [specRow] } });
    });
  });

  it('getProduct() surfaces categories from the include payload', (done) => {
    service.getProduct(productFixture.id).subscribe((p) => {
      expect(p.categories).toHaveLength(1);
      const row = p.categories![0];
      expect(row.categoryId).toBe('34f5c9a4-1a1a-4a4a-8a8a-333333333333');
      expect(row.category?.slug).toBe('bags');
      done();
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}`);
    req.flush({
      data: {
        ...productFixture,
        categories: [
          {
            productId: productFixture.id,
            categoryId: '34f5c9a4-1a1a-4a4a-8a8a-333333333333',
            category: {
              id: '34f5c9a4-1a1a-4a4a-8a8a-333333333333',
              name: { default: 'Sacs', fr: 'Sacs', en: 'Bags' },
              slug: 'bags',
            },
          },
        ],
      },
    });
  });

  /**
   * The list endpoint returns the junction rows without the joined category,
   * so the joined object has to stay optional or every list parse throws.
   */
  it('getProduct() accepts a category junction row with no joined category', (done) => {
    service.getProduct(productFixture.id).subscribe((p) => {
      expect(p.categories).toHaveLength(1);
      expect(p.categories![0].categoryId).toBe('34f5c9a4-1a1a-4a4a-8a8a-333333333333');
      done();
    });
    http.expectOne(`/api/v1/admin/products/${productFixture.id}`).flush({
      data: {
        ...productFixture,
        categories: [{ categoryId: '34f5c9a4-1a1a-4a4a-8a8a-333333333333' }],
      },
    });
  });

  it('getProduct() surfaces assets[].asset envelope from the include payload', (done) => {
    service.getProduct(productFixture.id).subscribe((p) => {
      expect(p.assets).toHaveLength(1);
      const row = p.assets![0];
      expect(row.assetId).toBe('a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa');
      expect(row.isPrimary).toBe(true);
      // `asset` is optional on the union schema (list omits the join,
      // detail includes it). Detail responses MUST carry the envelope.
      expect(row.asset).toBeDefined();
      const asset = row.asset!;
      expect(asset.id).toBe('a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa');
      expect(asset.url).toBe('https://cdn.test/x.jpg');
      expect(asset.type).toBe('IMAGE');
      expect(asset.status).toBe('READY');
      expect(asset.mimeType).toBe('image/jpeg');
      expect(asset.fileSize).toBe(2048);
      expect(asset.width).toBe(800);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}`);
    req.flush({
      data: {
        ...productFixture,
        assets: [
          {
            assetId: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
            sortOrder: 0,
            isPrimary: true,
            asset: {
              id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
              url: 'https://cdn.test/x.jpg',
              type: 'IMAGE',
              alt: { default: 'Alt' },
              status: 'READY',
              mimeType: 'image/jpeg',
              fileSize: 2048,
              width: 800,
              height: 600,
            },
          },
        ],
      },
    });
  });

  // ── AV3 — productAssetEnvelopeSchema accepts empty url + variants opaque ──

  it('getProduct() accepts a PROCESSING asset whose url is empty (AV3)', (done) => {
    service.getProduct(productFixture.id).subscribe((p) => {
      expect(p.assets).toHaveLength(1);
      const asset = p.assets![0].asset!;
      expect(asset.url).toBe('');
      expect(asset.status).toBe('PROCESSING');
      // variants payload survives Zod parse end-to-end so the admin shim
      // can resolve a URL once the processor flips status to READY.
      expect(asset.variants).toBeUndefined();
      done();
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}`);
    req.flush({
      data: {
        ...productFixture,
        assets: [
          {
            assetId: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
            sortOrder: 0,
            isPrimary: true,
            asset: {
              id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
              url: '',
              type: 'IMAGE',
              alt: { default: 'Pending' },
              status: 'PROCESSING',
              mimeType: 'image/jpeg',
              fileSize: 1024,
            },
          },
        ],
      },
    });
  });

  it('getProduct() preserves the variants JSONB on a READY asset (AV3)', (done) => {
    const variantsPayload = {
      thumbnail: {
        webp: {
          url: 'https://cdn.test/thumb.webp',
          storagePath: 'pub/thumb.webp',
          width: 160,
          height: 120,
          size: 100,
        },
        avif: {
          url: 'https://cdn.test/thumb.avif',
          storagePath: 'pub/thumb.avif',
          width: 160,
          height: 120,
          size: 90,
        },
      },
      small: {
        webp: {
          url: 'https://cdn.test/small.webp',
          storagePath: 'pub/small.webp',
          width: 320,
          height: 240,
          size: 200,
        },
        avif: {
          url: 'https://cdn.test/small.avif',
          storagePath: 'pub/small.avif',
          width: 320,
          height: 240,
          size: 180,
        },
      },
      medium: {
        webp: {
          url: 'https://cdn.test/med.webp',
          storagePath: 'pub/med.webp',
          width: 640,
          height: 480,
          size: 400,
        },
        avif: {
          url: 'https://cdn.test/med.avif',
          storagePath: 'pub/med.avif',
          width: 640,
          height: 480,
          size: 360,
        },
      },
      large: {
        webp: {
          url: 'https://cdn.test/large.webp',
          storagePath: 'pub/large.webp',
          width: 1280,
          height: 960,
          size: 800,
        },
        avif: {
          url: 'https://cdn.test/large.avif',
          storagePath: 'pub/large.avif',
          width: 1280,
          height: 960,
          size: 720,
        },
      },
    };
    service.getProduct(productFixture.id).subscribe((p) => {
      const asset = p.assets![0].asset!;
      expect(asset.variants).toBeDefined();
      done();
    });
    const req = http.expectOne(`/api/v1/admin/products/${productFixture.id}`);
    req.flush({
      data: {
        ...productFixture,
        assets: [
          {
            assetId: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
            sortOrder: 0,
            isPrimary: true,
            asset: {
              id: 'a4f5c9a4-1a1a-4a4a-8a8a-aaaaaaaaaaaa',
              url: 'https://cdn.test/large.webp',
              type: 'IMAGE',
              alt: { default: 'Alt' },
              status: 'READY',
              mimeType: 'image/jpeg',
              fileSize: 2048,
              width: 800,
              height: 600,
              variants: variantsPayload,
            },
          },
        ],
      },
    });
  });
});
