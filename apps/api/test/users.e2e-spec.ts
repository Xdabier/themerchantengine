import { PrismaClient } from '@prisma/client';
import { api, signUpCustomer, createTestPrisma } from '../../../test/e2e/helpers';

// ── Suite ─────────────────────────────────────────────────────────────────────

const SUFFIX = '@e2e-users.test';
const PASSWORD = 'StrongPass1';

describe('Users (e2e)', () => {
  let prisma: PrismaClient;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.$disconnect();
  });

  // ── GET /v1/users/me ───────────────────────────────────────────────────

  describe('GET /v1/users/me', () => {
    beforeAll(async () => {
      cookie = await signUpCustomer(prisma, `profile${SUFFIX}`, PASSWORD);
      const res = await api().get('/v1/users/me').set('Cookie', cookie);
      userId = (res.body.data as { id: string }).id;
    });

    it('returns 200 with own profile', async () => {
      const res = await api().get('/v1/users/me').set('Cookie', cookie).expect(200);

      expect(res.body.data.email).toBe(`profile${SUFFIX}`);
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    it('returns 401 without a session', () => {
      return api().get('/v1/users/me').expect(401);
    });
  });

  // ── PATCH /v1/users/me ─────────────────────────────────────────────────

  describe('PATCH /v1/users/me', () => {
    let updateCookie: string;

    beforeAll(async () => {
      updateCookie = await signUpCustomer(prisma, `update${SUFFIX}`, PASSWORD);
    });

    it('updates firstName and lastName', async () => {
      const res = await api()
        .patch('/v1/users/me')
        .set('Cookie', updateCookie)
        .send({ firstName: 'Updated', lastName: 'Name' })
        .expect(200);

      expect(res.body.data.firstName).toBe('Updated');
      expect(res.body.data.lastName).toBe('Name');
    });

    it('returns 400 + PROFILE_CURRENT_PASSWORD_REQUIRED when missing currentPassword', async () => {
      const res = await api()
        .patch('/v1/users/me')
        .set('Cookie', updateCookie)
        .send({ email: `new${SUFFIX}` });

      expect(res.status).toBe(400);
      // Stable code lets the storefront profile page surface a localized
      // message in both EN + AR (Full-Stack Audit plan §1.1 row #10).
      expect(res.body.error?.code).toBe('PROFILE_CURRENT_PASSWORD_REQUIRED');
    });

    it('returns 401 + PROFILE_CURRENT_PASSWORD_INCORRECT when currentPassword is wrong', async () => {
      const res = await api()
        .patch('/v1/users/me')
        .set('Cookie', updateCookie)
        .send({ email: `new${SUFFIX}`, currentPassword: 'WrongPass1' });

      expect(res.status).toBe(401);
      // Stable code lets the storefront profile page render a dedicated
      // localized message and skip the session-clear logout chain that
      // every other 401 path triggers (Full-Stack Audit plan §1.1 row #11).
      expect(res.body.error?.code).toBe('PROFILE_CURRENT_PASSWORD_INCORRECT');
    });

    it('routes an email change through verification without an immediate write (NE5 security fix)', async () => {
      const res = await api()
        .patch('/v1/users/me')
        .set('Cookie', updateCookie)
        .send({ email: `updated${SUFFIX}`, currentPassword: PASSWORD })
        .expect(200);

      // NE5 security fix: the new login email is NOT committed synchronously —
      // the change is routed through Better Auth's verified change-email flow
      // (confirmation to the new address + a security alert to the old one). The
      // profile still shows the current email until the new address is confirmed.
      expect(res.body.data.email).toBe(`update${SUFFIX}`);
    });

    it('returns 409 + PROFILE_EMAIL_IN_USE when email already owned by another account', async () => {
      // Register a sibling account, then attempt to update the email to the
      // sibling's address — the uniqueness probe in `users.service.ts`
      // updateProfile must reject with the stable code.
      const siblingEmail = `sibling-${Date.now()}${SUFFIX}`;
      await signUpCustomer(prisma, siblingEmail, PASSWORD);

      const res = await api()
        .patch('/v1/users/me')
        .set('Cookie', updateCookie)
        .send({ email: siblingEmail, currentPassword: PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe('PROFILE_EMAIL_IN_USE');
    });
  });

  // ── Address CRUD ───────────────────────────────────────────────────────

  describe('Address CRUD lifecycle', () => {
    let addressCookie: string;
    let createdAddressId: string;

    beforeAll(async () => {
      addressCookie = await signUpCustomer(prisma, `address${SUFFIX}`, PASSWORD);
    });

    const addressPayload = {
      fullName: 'E2E User',
      phone: '+12125551234',
      addressLine1: '123 Main St',
      city: 'New York',
      country: 'US',
    };

    it('POST /v1/users/me/addresses — creates an address', async () => {
      const res = await api()
        .post('/v1/users/me/addresses')
        .set('Cookie', addressCookie)
        .send(addressPayload)
        .expect(201);

      expect(res.body.data.fullName).toBe('E2E User');
      expect(res.body.data.country).toBe('US');
      expect(res.body.data.isDefaultShipping).toBe(false);
      createdAddressId = (res.body.data as { id: string }).id;
    });

    it('POST — rejects missing required fields', () => {
      return api()
        .post('/v1/users/me/addresses')
        .set('Cookie', addressCookie)
        .send({ fullName: 'No Country' })
        .expect(400);
    });

    it('POST — rejects invalid country code', () => {
      return api()
        .post('/v1/users/me/addresses')
        .set('Cookie', addressCookie)
        .send({ ...addressPayload, country: 'USA' })
        .expect(400);
    });

    it('POST — lowercased country is transformed to uppercase', async () => {
      const res = await api()
        .post('/v1/users/me/addresses')
        .set('Cookie', addressCookie)
        .send({ ...addressPayload, country: 'gb' })
        .expect(201);

      expect(res.body.data.country).toBe('GB');

      await api()
        .delete(`/v1/users/me/addresses/${res.body.data.id as string}`)
        .set('Cookie', addressCookie);
    });

    it('PATCH /v1/users/me/addresses/:id — updates city', async () => {
      const res = await api()
        .patch(`/v1/users/me/addresses/${createdAddressId}`)
        .set('Cookie', addressCookie)
        .send({ city: 'Brooklyn' })
        .expect(200);

      expect(res.body.data.city).toBe('Brooklyn');
    });

    it('PATCH — returns 404 for unknown address', () => {
      return api()
        .patch('/v1/users/me/addresses/nonexistent-id')
        .set('Cookie', addressCookie)
        .send({ city: 'Chicago' })
        .expect(404);
    });

    it('PATCH — returns 403 when address belongs to another user', async () => {
      const otherCookie = await signUpCustomer(prisma, `other${SUFFIX}`, PASSWORD);

      return api()
        .patch(`/v1/users/me/addresses/${createdAddressId}`)
        .set('Cookie', otherCookie)
        .send({ city: 'Chicago' })
        .expect(403);
    });

    // ── Default address logic ────────────────────────────────────────────

    it('PATCH .../default — sets address as default shipping', async () => {
      const res = await api()
        .patch(`/v1/users/me/addresses/${createdAddressId}/default`)
        .set('Cookie', addressCookie)
        .send({ isDefaultShipping: true })
        .expect(200);

      expect(res.body.data.isDefaultShipping).toBe(true);
    });

    it('PATCH .../default — second address takes over as default, first is cleared', async () => {
      const secondRes = await api()
        .post('/v1/users/me/addresses')
        .set('Cookie', addressCookie)
        .send({ ...addressPayload, fullName: 'Second Address', isDefaultShipping: true })
        .expect(201);

      const secondId = (secondRes.body.data as { id: string }).id;

      const firstRes = await prisma.address.findUnique({ where: { id: createdAddressId } });
      expect(firstRes?.isDefaultShipping).toBe(false);

      await api().delete(`/v1/users/me/addresses/${secondId}`).set('Cookie', addressCookie);
    });

    it('PATCH .../default — 400 + ADDRESS_DEFAULT_FLAG_REQUIRED when no flag is true', async () => {
      const res = await api()
        .patch(`/v1/users/me/addresses/${createdAddressId}/default`)
        .set('Cookie', addressCookie)
        .send({});

      expect(res.status).toBe(400);
      // B2 row #26: typed code disambiguates the validation rejection from a
      // generic 400 toast on the addresses page.
      expect(res.body.error?.code).toBe('ADDRESS_DEFAULT_FLAG_REQUIRED');
    });

    it('DELETE /v1/users/me/addresses/:id — deletes address', () => {
      return api()
        .delete(`/v1/users/me/addresses/${createdAddressId}`)
        .set('Cookie', addressCookie)
        .expect(204);
    });

    it('DELETE — returns 404 after address is gone', () => {
      return api()
        .delete(`/v1/users/me/addresses/${createdAddressId}`)
        .set('Cookie', addressCookie)
        .expect(404);
    });
  });

  // ── Admin: GET /v1/admin/customers ─────────────────────────────────────

  describe('GET /v1/admin/customers', () => {
    it('returns 403 for a regular customer session', async () => {
      const customerCookie = await signUpCustomer(prisma, `cust${SUFFIX}`, PASSWORD);

      return api().get('/v1/admin/customers').set('Cookie', customerCookie).expect(403);
    });

    it('returns 401 without a session', () => {
      return api().get('/v1/admin/customers').expect(401);
    });
  });

  // ── Admin: GET /v1/admin/customers/:id ────────────────────────────────

  describe('GET /v1/admin/customers/:id', () => {
    it('returns 403 for a regular customer session', async () => {
      const customerCookie = await signUpCustomer(prisma, `cust2${SUFFIX}`, PASSWORD);

      return api().get(`/v1/admin/customers/${userId}`).set('Cookie', customerCookie).expect(403);
    });
  });
});
