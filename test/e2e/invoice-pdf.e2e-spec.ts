import 'reflect-metadata';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Response } from 'supertest';
import {
  ADMIN,
  STORE_ADDRESS,
  api,
  createTestPrisma,
  loginAs,
  shippingMethodForCountry,
  signUpCustomer,
} from './helpers';

/**
 * Invoice PDF download — full-stack e2e on the real dockerized DB.
 *
 * Exercises the lazy-render + cached-serve + owner-scoping contract end to end:
 *   - CONFIRMED order → `GET /v1/orders/:id/invoice` carries a `downloadUrl`
 *   - `GET /v1/orders/:id/invoice/pdf` streams a non-empty `application/pdf`
 *     (both fr + en), first render + cached re-serve
 *   - ownership 403, unconfirmed → 404 ORDER_INVOICE_NOT_READY, anon → 401
 */

const PRODUCT_SLUG = 'urban-runner-sneakers';
const OWNER_EMAIL = `inv-pdf-owner-${randomUUID()}@e2e.test`;
const OTHER_EMAIL = `inv-pdf-other-${randomUUID()}@e2e.test`;
const PASSWORD = 'InvoicePdf1!';

/** Collect a binary (non-JSON) response body into a Buffer. */
function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Invoice PDF download (e2e)', () => {
  let prisma: PrismaClient;
  let ownerCookie: string;
  let otherCookie: string;
  let adminCookie: string;
  let variantId: string;
  let shippingMethodId: string;
  let confirmedOrderId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    ownerCookie = await signUpCustomer(prisma, OWNER_EMAIL, PASSWORD, {
      firstName: 'Inv',
      lastName: 'Owner',
    });
    otherCookie = await signUpCustomer(prisma, OTHER_EMAIL, PASSWORD, {
      firstName: 'Inv',
      lastName: 'Other',
    });

    // A method that actually serves the destination, not `data[0]` of a list
    // ordered by sortOrder across every zone. See shippingMethodForCountry.
    shippingMethodId = await shippingMethodForCountry(adminCookie, STORE_ADDRESS.country);
    expect(shippingMethodId).toBeDefined();

    const productRes = await api().get(`/v1/products/${PRODUCT_SLUG}`).expect(200);
    variantId = productRes.body.data.variants[0]?.id;
    expect(variantId).toBeDefined();
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_EMAIL] } } });
    } catch {
      // ignore
    }
    await prisma.$disconnect();
  });

  async function placeOrder(cookie: string): Promise<string> {
    await api()
      .post('/v1/cart/items')
      .set('Cookie', cookie)
      .send({ variantId, quantity: 1 })
      .expect(200);
    const res = await api()
      .post('/v1/orders')
      .set('Cookie', cookie)
      .set('X-Idempotency-Key', randomUUID())
      .send({ shippingAddress: STORE_ADDRESS, shippingMethodId })
      .expect(201);
    return res.body.data.id as string;
  }

  it('CONFIRMED order → invoice JSON carries the storefront downloadUrl', async () => {
    confirmedOrderId = await placeOrder(ownerCookie);
    await api()
      .patch(`/v1/admin/orders/${confirmedOrderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    const res = await api()
      .get(`/v1/orders/${confirmedOrderId}/invoice`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(res.body.data.downloadUrl).toBe(`/v1/orders/${confirmedOrderId}/invoice/pdf`);
  });

  it.each(['fr', 'en'])(
    'streams a non-empty application/pdf for the owner (%s)',
    async (locale) => {
      const res = await api()
        .get(`/v1/orders/${confirmedOrderId}/invoice/pdf`)
        .set('Cookie', ownerCookie)
        .set('Accept-Language', locale)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.pdf');
      // PII → must not be cached by intermediaries (§3.15-A default).
      expect(res.headers['cache-control']).toContain('no-store');
      const buf = res.body as Buffer;
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(3000);
    },
  );

  it('serves the cached object on a second download (still a valid PDF)', async () => {
    const res = await api()
      .get(`/v1/orders/${confirmedOrderId}/invoice/pdf`)
      .set('Cookie', ownerCookie)
      .set('Accept-Language', 'fr')
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders each locale as its own document rather than serving the first one cached', async () => {
    const get = async (locale: string) => {
      const res = await api()
        .get(`/v1/orders/${confirmedOrderId}/invoice/pdf`)
        .set('Cookie', ownerCookie)
        .set('Accept-Language', locale)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      return res.body as Buffer;
    };

    // The cached object key carries the locale since D7. On the shared key it
    // had before, whichever language was requested first was served to every
    // later reader, in a document the customer cannot re-request in their own.
    expect(Buffer.compare(await get('fr'), await get('en'))).not.toBe(0);
  });

  it('rejects a non-owner caller with 403', async () => {
    await api()
      .get(`/v1/orders/${confirmedOrderId}/invoice/pdf`)
      .set('Cookie', otherCookie)
      .expect(403);
  });

  it('returns 404 ORDER_INVOICE_NOT_READY for an unconfirmed (PENDING) order', async () => {
    const pendingOrderId = await placeOrder(ownerCookie);
    const res = await api()
      .get(`/v1/orders/${pendingOrderId}/invoice/pdf`)
      .set('Cookie', ownerCookie)
      .expect(404);
    expect(res.body.error.code).toBe('ORDER_INVOICE_NOT_READY');
  });

  it('requires authentication (401 for an anonymous caller)', async () => {
    await api().get(`/v1/orders/${confirmedOrderId}/invoice/pdf`).expect(401);
  });
});
