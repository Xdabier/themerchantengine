import { productStockSchema, variantStockDetailSchema } from './inventory.schemas';

/**
 * Contract tests against payloads CAPTURED FROM THE RUNNING API, not hand-built
 * from the schema they are meant to guard.
 *
 * A hand-built fixture is written by reading the schema, so it agrees with the
 * schema by construction and proves nothing about the server. That is how a
 * double-wrapped response — the service returning `{ data: … }` on top of the
 * envelope the global interceptor already adds — passed every unit test on both
 * sides while the screen reported "Could not load stock for this product".
 *
 * These bodies are the `data` field of a real 200 from
 * `GET /v1/admin/products/:id/stock` and
 * `GET /v1/admin/inventory/variant/:variantId`, recorded 2026-08-27 against the
 * dev database. Re-capture them if either response shape changes on purpose.
 */

/** Real response, trimmed to one location and one variant. */
const LIVE_PRODUCT_STOCK = {
  lowStockThreshold: 5,
  locations: [
    {
      id: 'cmtal9ffs00ar5gqsbdrj56hg',
      name: 'the fixture catalogue Main Warehouse',
      code: 'FIXTURE_CATALOGUE-MAIN-WH',
      isActive: true,
    },
    // A location seeded with a non-cuid id, which is why entity ids are not
    // validated as cuid or as uuid but as a conservative character set.
    { id: 'loc-main-wh', name: 'Main Warehouse', code: 'MAIN-WH', isActive: true },
    {
      id: '7c6036bc-ef78-5e05-83a8-cd8b57051507',
      name: 'Lyon, entrepot principal',
      code: 'LYON-MAIN',
      isActive: true,
    },
  ],
  variants: [
    {
      variantId: 'cmtal9ffc00aq5gqskmtnwxzl',
      sku: 'KH-PC-TE',
      isDefault: true,
      totals: { onHand: 89, reserved: 0, available: 89 },
      status: 'IN_STOCK',
      levels: [
        {
          stockLevelId: 'cmtal9fho00br5gqsshvyreeb',
          locationId: 'cmtal9ffs00ar5gqsbdrj56hg',
          location: {
            id: 'cmtal9ffs00ar5gqsbdrj56hg',
            name: 'the fixture catalogue Main Warehouse',
            code: 'FIXTURE_CATALOGUE-MAIN-WH',
            isActive: true,
          },
          onHand: 89,
          reserved: 0,
          available: 89,
          updatedAt: '2026-08-26T21:11:11.532Z',
        },
      ],
    },
  ],
};

/** Real response with `X-Resolve-Locale: false`, so names arrive Translatable. */
const LIVE_VARIANT_DETAIL = {
  variant: {
    id: 'cmtal9ffc00aq5gqskmtnwxzl',
    sku: 'KH-PC-TE',
    product: {
      id: 'cmtal9ff800ap5gqsy23jsrci',
      name: { en: 'Travel Essentials', fr: 'Essentiels Voyage', default: 'Travel Essentials' },
      slug: 'fx-skincare-travel-essentials',
    },
  },
  levels: [
    {
      id: 'cmtal9fho00br5gqsshvyreeb',
      variantId: 'cmtal9ffc00aq5gqskmtnwxzl',
      locationId: 'cmtal9ffs00ar5gqsbdrj56hg',
      onHand: 89,
      reserved: 0,
      updatedAt: '2026-08-26T21:11:11.532Z',
      location: {
        id: 'cmtal9ffs00ar5gqsbdrj56hg',
        name: 'the fixture catalogue Main Warehouse',
        code: 'FIXTURE_CATALOGUE-MAIN-WH',
        isActive: true,
      },
      available: 89,
    },
  ],
};

describe('live API contract', () => {
  it('productStockSchema parses a real product-stock response', () => {
    const result = productStockSchema.safeParse(LIVE_PRODUCT_STOCK);
    expect(result.success ? null : result.error.issues).toBeNull();
  });

  it('variantStockDetailSchema parses a real variant-stock response', () => {
    const result = variantStockDetailSchema.safeParse(LIVE_VARIANT_DETAIL);
    expect(result.success ? null : result.error.issues).toBeNull();
  });

  /**
   * The defect itself. The client unwraps ONE envelope, so a service that adds
   * its own leaves `{ data: … }` where the payload should be, and every field
   * the schema wants is one level too deep.
   */
  it('rejects a double-wrapped body rather than accepting it silently', () => {
    expect(productStockSchema.safeParse({ data: LIVE_PRODUCT_STOCK }).success).toBe(false);
    expect(variantStockDetailSchema.safeParse({ data: LIVE_VARIANT_DETAIL }).success).toBe(false);
  });
});
