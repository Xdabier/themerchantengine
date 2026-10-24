import { PrismaClient } from '@prisma/client';
import { api, createTestPrisma, createUserWithRole, loginAs } from '../../../test/e2e/helpers';

// ── Constants ──────────────────────────────────────────────────────────────────

const TEST_SUFFIX = '@e2e-tax.test';
const TEST_PASSWORD = 'StrongPass1';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Tax (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let adminRoleId: string | undefined;

  let highPriorityZoneId: string;
  let lowPriorityZoneId: string;
  let defaultZoneId: string;
  let standardClassId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();

    // ── Clean up previous runs ────────────────────────────────────────────────
    await prisma.taxClass.deleteMany({
      where: { zone: { name: { path: ['default'], string_starts_with: 'E2E-Tax-' } } },
    });
    await prisma.taxZone.deleteMany({
      where: { name: { path: ['default'], string_starts_with: 'E2E-Tax-' } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });

    // ── Create admin user with the tax-settings permission set ────────────────
    const { roleId } = await createUserWithRole(prisma, {
      email: `admin${TEST_SUFFIX}`,
      password: TEST_PASSWORD,
      role: 'ADMIN',
      permissions: ['settings:view', 'settings:manage'],
      firstName: 'Tax',
      lastName: 'Admin',
    });
    adminRoleId = roleId;

    adminCookie = await loginAs(`admin${TEST_SUFFIX}`, TEST_PASSWORD);
  });

  afterAll(async () => {
    await prisma.taxClass.deleteMany({
      where: { zone: { name: { path: ['default'], string_starts_with: 'E2E-Tax-' } } },
    });
    await prisma.taxZone.deleteMany({
      where: { name: { path: ['default'], string_starts_with: 'E2E-Tax-' } },
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    if (adminRoleId) {
      await prisma.role.deleteMany({ where: { id: adminRoleId } });
    }
    await prisma.$disconnect();
  });

  // ── 1. Create zones ────────────────────────────────────────────────────────

  it('POST /v1/admin/tax/zones — creates high-priority zone (priority 1, rate 8%)', async () => {
    const res = await api()
      .post('/v1/admin/tax/zones')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E-Tax-High', en: 'E2E-Tax-High' },
        countries: ['T1'],
        rate: 0.08,
        priority: 1,
        isDefault: false,
        isActive: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    highPriorityZoneId = res.body.data.id as string;
  });

  it('POST /v1/admin/tax/zones — creates low-priority zone (priority 10, rate 5%)', async () => {
    const res = await api()
      .post('/v1/admin/tax/zones')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E-Tax-Low', en: 'E2E-Tax-Low' },
        countries: ['T1'],
        rate: 0.05,
        priority: 10,
        isDefault: false,
        isActive: true,
      });

    expect(res.status).toBe(201);
    lowPriorityZoneId = res.body.data.id as string;
  });

  it('POST /v1/admin/tax/zones — creates default fallback zone (rate 10%)', async () => {
    const res = await api()
      .post('/v1/admin/tax/zones')
      .set('Cookie', adminCookie)
      .send({
        name: { default: 'E2E-Tax-Default', en: 'E2E-Tax-Default' },
        countries: [],
        rate: 0.1,
        priority: 99,
        isDefault: true,
        isActive: true,
      });

    expect(res.status).toBe(201);
    defaultZoneId = res.body.data.id as string;
  });

  // ── 2. List zones ──────────────────────────────────────────────────────────

  it('GET /v1/admin/tax/zones — returns all zones ordered by priority', async () => {
    const res = await api()
      .get('/v1/admin/tax/zones')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);

    const ids = (res.body.data as Array<{ id: string }>).map((z) => z.id);
    expect(ids).toContain(highPriorityZoneId);
    expect(ids).toContain(lowPriorityZoneId);
    expect(ids).toContain(defaultZoneId);
  });

  // ── 3. Create tax classes ──────────────────────────────────────────────────

  it('POST /v1/admin/tax/classes — creates Standard class in high-priority zone', async () => {
    const res = await api()
      .post('/v1/admin/tax/classes')
      .set('Cookie', adminCookie)
      .send({
        zoneId: highPriorityZoneId,
        name: 'Standard',
        rate: 0.08,
        isDefault: true,
      });

    expect(res.status).toBe(201);
    standardClassId = res.body.data.id as string;
  });

  it('POST /v1/admin/tax/classes — creates Zero-Rated class in high-priority zone', async () => {
    const res = await api()
      .post('/v1/admin/tax/classes')
      .set('Cookie', adminCookie)
      .send({
        zoneId: highPriorityZoneId,
        name: 'Zero-Rated',
        rate: 0,
      });

    expect(res.status).toBe(201);
  });

  it('POST /v1/admin/tax/classes — 404 for unknown zoneId', async () => {
    const res = await api()
      .post('/v1/admin/tax/classes')
      .set('Cookie', adminCookie)
      .send({ zoneId: 'nonexistent', name: 'Standard', rate: 0.05 });

    expect(res.status).toBe(404);
  });

  // ── 4. List tax classes ────────────────────────────────────────────────────

  it('GET /v1/admin/tax/classes — returns classes for zone', async () => {
    const res = await api()
      .get(`/v1/admin/tax/classes?zoneId=${highPriorityZoneId}`)
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
  });

  // ── 5. Update a zone ───────────────────────────────────────────────────────

  it('PATCH /v1/admin/tax/zones/:id — updates rate', async () => {
    const res = await api()
      .patch(`/v1/admin/tax/zones/${highPriorityZoneId}`)
      .set('Cookie', adminCookie)
      .send({ rate: 0.09 });

    expect(res.status).toBe(200);
    expect(Number(res.body.data.rate)).toBeCloseTo(0.09);
  });

  it('PATCH /v1/admin/tax/zones/:id — 404 for unknown id', async () => {
    const res = await api()
      .patch('/v1/admin/tax/zones/nonexistent-id')
      .set('Cookie', adminCookie)
      .send({ rate: 0.1 });

    expect(res.status).toBe(404);
  });

  // ── 6. Auth guards ─────────────────────────────────────────────────────────

  it('GET /v1/admin/tax/zones — 401 without token', async () => {
    const res = await api().get('/v1/admin/tax/zones');
    expect(res.status).toBe(401);
  });

  it('POST /v1/admin/tax/zones — 401 without token', async () => {
    const res = await api()
      .post('/v1/admin/tax/zones')
      .send({ name: { default: 'Test' }, countries: ['QA'], rate: 0.05 });
    expect(res.status).toBe(401);
  });

  // ── 7. Validation guards ───────────────────────────────────────────────────

  it('POST /v1/admin/tax/zones — 400 when rate > 1', async () => {
    const res = await api()
      .post('/v1/admin/tax/zones')
      .set('Cookie', adminCookie)
      .send({ name: { default: 'Bad' }, countries: ['QA'], rate: 1.5 });

    expect(res.status).toBe(400);
  });
});
