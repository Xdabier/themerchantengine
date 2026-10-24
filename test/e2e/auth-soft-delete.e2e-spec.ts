import { PrismaClient } from '@prisma/client';
import { api, signUpCustomer, createUserWithRole, createTestPrisma } from './helpers';

/**
 * BA2.7 + BA2.17 — soft-delete and deactivation hold through the Better Auth
 * adapter (spec §4.D6).
 *
 * `auth.ts` gives Better Auth's Prisma adapter the soft-delete-extended
 * client, and `SessionAuthGuard` re-reads the user through the same extended
 * client on every request. A `deletedAt`-set user is therefore filtered out
 * of every lookup, and a deactivated (`isActive: false`) user is rejected by
 * the guard — neither can hold or obtain a valid session.
 */

const SUFFIX = '@e2e-softdel.test';
const PASSWORD = 'SoftDelPass1!';

describe('Soft-delete + deactivation — no valid session (e2e)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.$disconnect();
  });

  it('a soft-deleted user can no longer use an existing session', async () => {
    const email = `existing-session${SUFFIX}`;
    const cookie = await signUpCustomer(prisma, email, PASSWORD);

    // Sanity — the session works before the soft-delete.
    await api().get('/v1/users/me').set('Cookie', cookie).expect(200);

    await prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    // SessionAuthGuard re-reads the user through the soft-delete-extended
    // client; the `deletedAt` row is filtered out, so the request is rejected.
    const res = await api().get('/v1/users/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });

  it('a soft-deleted user cannot sign in', async () => {
    const email = `signin${SUFFIX}`;
    await createUserWithRole(prisma, { email, password: PASSWORD, role: 'CUSTOMER' });
    await prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    const res = await api().post('/v1/auth/sign-in/email').send({ email, password: PASSWORD });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a deactivated user is rejected with AUTH_USER_DEACTIVATED', async () => {
    const email = `deactivated${SUFFIX}`;
    const cookie = await signUpCustomer(prisma, email, PASSWORD);

    await api().get('/v1/users/me').set('Cookie', cookie).expect(200);

    await prisma.user.update({ where: { email }, data: { isActive: false } });

    const res = await api().get('/v1/users/me').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('AUTH_USER_DEACTIVATED');
  });
});
