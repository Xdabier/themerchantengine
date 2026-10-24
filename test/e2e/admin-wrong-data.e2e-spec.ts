/**
 * Admin "wrong data" E2E — plan F (specs/features/admin-qa-remediation/plan-f-wrong-data.md).
 *
 * Every case here pins a screen that used to render something factually false:
 *   F1/F2 — inventory rows carried no status, so every badge said "In Stock".
 *   F3/F4 — customers carried `_count.orders` while the UI read `orderCount`,
 *           and lifetime value / segment had no source at all.
 *   F6/F7 — the staff list dropped `role` on parse and hid SUPER_ADMIN rows.
 *
 * Runs against the real dockerized API + seeded database. No mocks.
 */
import { PrismaClient } from '@prisma/client';
import { api, loginAs, createTestPrisma, ADMIN } from './helpers';

type StockRow = {
  id: string;
  onHand: number;
  status: string;
  lowStockThreshold: number;
  variant?: { sku: string };
};

type CustomerRow = {
  id: string;
  email: string;
  orderCount: number;
  totalSpent: number;
  segment: string | null;
};

type StaffRow = {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  customRole: { id: string; name: string } | null;
};

describe('Admin wrong-data remediation (e2e)', () => {
  let prisma: PrismaClient;
  let adminCookie: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── F1 / F2: inventory status is real, and the filter agrees with it ──────

  describe('GET /v1/admin/inventory', () => {
    it('carries a per-row status and the effective threshold', async () => {
      const res = await api()
        .get('/v1/admin/inventory?pageSize=100')
        .set('Cookie', adminCookie)
        .expect(200);

      const rows = res.body.data as StockRow[];
      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).toContain(row.status);
        expect(typeof row.lowStockThreshold).toBe('number');
        const expected =
          row.onHand <= 0
            ? 'OUT_OF_STOCK'
            : row.onHand <= row.lowStockThreshold
              ? 'LOW_STOCK'
              : 'IN_STOCK';
        expect(row.status).toBe(expected);
      }

      // The seed pins JEAN-XL-BLK at zero on hand — the row that used to claim
      // "In Stock" on the dashboard.
      const outOfStock = rows.filter((r) => r.status === 'OUT_OF_STOCK');
      expect(outOfStock.length).toBeGreaterThan(0);
    });

    it('honours the LOW_STOCK filter with that same threshold', async () => {
      const res = await api()
        .get('/v1/admin/inventory?pageSize=100&stockStatus=LOW_STOCK')
        .set('Cookie', adminCookie)
        .expect(200);

      const rows = res.body.data as StockRow[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.status).toBe('LOW_STOCK');
        expect(row.onHand).toBeGreaterThan(0);
        expect(row.onHand).toBeLessThanOrEqual(row.lowStockThreshold);
      }
    });

    it('honours the OUT_OF_STOCK filter', async () => {
      const res = await api()
        .get('/v1/admin/inventory?pageSize=100&stockStatus=OUT_OF_STOCK')
        .set('Cookie', adminCookie)
        .expect(200);

      const rows = res.body.data as StockRow[];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.status).toBe('OUT_OF_STOCK');
        expect(row.onHand).toBeLessThanOrEqual(0);
      }
    });
  });

  // ── F3 / F4: customers carry real counts, money, and cohort ───────────────

  describe('GET /v1/admin/customers', () => {
    it('returns the seeded customer with her real order count', async () => {
      const res = await api()
        .get('/v1/admin/customers?search=customer2@test.com')
        .set('Cookie', adminCookie)
        .expect(200);

      const rows = res.body.data as CustomerRow[];
      const sara = rows.find((r) => r.email === 'customer2@test.com');
      expect(sara).toBeDefined();

      const actual = await prisma.order.count({ where: { userId: sara!.id } });
      expect(sara!.orderCount).toBe(actual);
      expect(sara!.orderCount).toBeGreaterThan(0);
      expect(typeof sara!.totalSpent).toBe('number');
      expect(sara!.totalSpent).toBeGreaterThan(0);
      expect(sara!.segment).not.toBeNull();
    });

    it('applies the segment filter instead of silently ignoring it', async () => {
      const all = await api()
        .get('/v1/admin/customers?pageSize=100')
        .set('Cookie', adminCookie)
        .expect(200);
      const active = await api()
        .get('/v1/admin/customers?pageSize=100&segment=ACTIVE')
        .set('Cookie', adminCookie)
        .expect(200);

      const activeRows = active.body.data as CustomerRow[];
      // Every returned row really did order inside the 90-day window.
      for (const row of activeRows) {
        const recent = await prisma.order.count({
          where: {
            userId: row.id,
            createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
        });
        expect(recent).toBeGreaterThan(0);
      }
      expect(active.body.meta.total).toBeLessThanOrEqual(all.body.meta.total);
    });

    it('matches nobody for the criteria-less VIP segment', async () => {
      const res = await api()
        .get('/v1/admin/customers?segment=VIP')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.meta.total).toBe(0);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('GET /v1/admin/customers/:id', () => {
    it('carries the flattened counts and the lifetime aggregate', async () => {
      const list = await api()
        .get('/v1/admin/customers?search=customer2@test.com')
        .set('Cookie', adminCookie)
        .expect(200);
      const sara = (list.body.data as CustomerRow[]).find((r) => r.email === 'customer2@test.com')!;

      const res = await api()
        .get(`/v1/admin/customers/${sara.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const body = res.body.data as CustomerRow & {
        reviewCount: number;
        returnCount: number;
        addresses: unknown[];
      };
      expect(body.orderCount).toBe(sara.orderCount);
      expect(body.totalSpent).toBe(sara.totalSpent);
      expect(typeof body.reviewCount).toBe('number');
      expect(typeof body.returnCount).toBe('number');
      expect(Array.isArray(body.addresses)).toBe(true);
    });
  });

  // ── F6 / F7: staff list tells the whole truth, mutations stay guarded ─────

  describe('GET /v1/admin/staff', () => {
    it('lists every back-office account, super admins included', async () => {
      const res = await api()
        .get('/v1/admin/staff?pageSize=100')
        .set('Cookie', adminCookie)
        .expect(200);

      const rows = res.body.data as StaffRow[];
      const emails = rows.map((r) => r.email);
      for (const seeded of [
        'superadmin@merchants.test',
        'admin@merchants.test',
        'manager@merchants.test',
        'support@merchants.test',
      ]) {
        expect(emails).toContain(seeded);
      }

      // Every row carries the fields the ROLES and STATUS columns bind.
      for (const row of rows) {
        expect(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT']).toContain(row.role);
        expect(typeof row.isActive).toBe('boolean');
      }
    });

    it('filters by SUPER_ADMIN', async () => {
      const res = await api()
        .get('/v1/admin/staff?role=SUPER_ADMIN&pageSize=100')
        .set('Cookie', adminCookie)
        .expect(200);

      const rows = res.body.data as StaffRow[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.role === 'SUPER_ADMIN')).toBe(true);
    });

    it('still refuses to mutate a SUPER_ADMIN through the staff surface', async () => {
      const target = await prisma.user.findUnique({
        where: { email: 'superadmin@merchants.test' },
        select: { id: true },
      });
      expect(target).not.toBeNull();

      await api()
        .patch(`/v1/admin/staff/${target!.id}`)
        .set('Cookie', adminCookie)
        .send({ firstName: 'Nope' })
        .expect(404);

      await api().delete(`/v1/admin/staff/${target!.id}`).set('Cookie', adminCookie).expect(404);
    });
  });
});
