/**
 * AV1 + AV2 — asset-variant-serving feature e2e coverage:
 *  - POST /v1/admin/assets/upload (AV2) — video MIME types now accepted
 *    (the AV1 rejection guard was lifted at AV2 alongside the FFmpeg
 *    processor). Smoke verifies the controller returns 201 + status
 *    PROCESSING for both video/mp4 and video/webm; the live-worker
 *    transcode + rendition + poster + original-deletion happy path defers
 *    to AV5 cutover verification (mirroring the AV1 image deferral) since
 *    it requires a live BullMQ worker + system FFmpeg + storage round-trip.
 *  - GET /v1/admin/assets/:id/original-url (AV1) — admin signed-URL
 *    endpoint, `assets:view` gate, 404 when originalStoragePath is null,
 *    5-min TTL.
 */
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { api, loginAs, signUpCustomer, createTestPrisma, ADMIN } from './helpers';

const TEST_TAG = `assets-variant-${Date.now()}`;
const TEST_SUFFIX = `@e2e-${TEST_TAG}.test`;
const TEST_PASSWORD = 'StrongPass1!';

// Minimal valid mp4 buffer — `ftyp` box at offset 4 with `isom` brand.
function makeMp4Buffer(): Buffer {
  const buf = Buffer.alloc(32, 0x00);
  buf[4] = 0x66;
  buf[5] = 0x74;
  buf[6] = 0x79;
  buf[7] = 0x70; // "ftyp"
  buf[8] = 0x69;
  buf[9] = 0x73;
  buf[10] = 0x6f;
  buf[11] = 0x6d; // "isom"
  return buf;
}

// Minimal valid webm buffer — EBML magic bytes.
function makeWebmBuffer(): Buffer {
  const buf = Buffer.alloc(64, 0x00);
  buf[0] = 0x1a;
  buf[1] = 0x45;
  buf[2] = 0xdf;
  buf[3] = 0xa3;
  return buf;
}

describe('Assets — AV1 (asset-variant-serving) e2e', () => {
  let prisma: PrismaClient;
  let adminCookie: string;
  let customerCookie: string;

  let assetWithOriginalId: string;
  let assetWithoutOriginalId: string;

  beforeAll(async () => {
    prisma = createTestPrisma();
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);

    customerCookie = await signUpCustomer(prisma, `customer${TEST_SUFFIX}`, TEST_PASSWORD, {
      firstName: 'Cust',
      lastName: 'Omer',
    });

    // Asset with originalStoragePath populated — signed-URL endpoint should
    // mint a valid presigned URL.
    const withOriginal = await prisma.asset.create({
      data: {
        url: 'https://cdn.test/assets-variant/large.webp',
        type: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: 4096,
        status: 'READY',
        storagePath: `assets/${TEST_TAG}/large.webp`,
        originalStoragePath: `private/assets/${TEST_TAG}/${crypto.randomUUID()}/original.jpg`,
      },
    });
    assetWithOriginalId = withOriginal.id;

    // Asset post-deletion — originalStoragePath NULL.
    const withoutOriginal = await prisma.asset.create({
      data: {
        url: 'https://cdn.test/assets-variant/large2.webp',
        type: 'IMAGE',
        mimeType: 'image/webp',
        fileSize: 2048,
        status: 'READY',
        storagePath: `assets/${TEST_TAG}/large2.webp`,
        originalStoragePath: null,
      },
    });
    assetWithoutOriginalId = withoutOriginal.id;
  });

  afterAll(async () => {
    try {
      await prisma.asset.deleteMany({
        where: { id: { in: [assetWithOriginalId, assetWithoutOriginalId] } },
      });
      await prisma.refreshToken.deleteMany({
        where: { user: { email: { endsWith: TEST_SUFFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: TEST_SUFFIX } } });
    } catch {
      // best-effort cleanup
    }
    await prisma.$disconnect();
  });

  // ── AV2 video upload smoke ────────────────────────────────────────────────

  describe('POST /v1/admin/assets/upload — video accepted (AV2)', () => {
    // The smoke covers controller → service → row-create → queue-enqueue.
    // It does NOT wait for the FFmpeg worker; transcoding + rendition + poster
    // + original-deletion verification rides AV5 cutover where a real
    // catalogue seed runs through the live pipeline.
    const createdVideoIds: string[] = [];

    afterAll(async () => {
      if (createdVideoIds.length > 0) {
        await prisma.asset.deleteMany({ where: { id: { in: createdVideoIds } } });
      }
    });

    it('201 + status PROCESSING for video/mp4', async () => {
      const res = await api()
        .post('/v1/admin/assets/upload')
        .set('Cookie', adminCookie)
        .attach('file', makeMp4Buffer(), { filename: 'clip.mp4', contentType: 'video/mp4' })
        .expect(201);
      expect(res.body.data.type).toBe('VIDEO');
      expect(res.body.data.status).toBe('PROCESSING');
      expect(res.body.data.mimeType).toBe('video/mp4');
      createdVideoIds.push(res.body.data.id);
    });

    it('201 + status PROCESSING for video/webm', async () => {
      const res = await api()
        .post('/v1/admin/assets/upload')
        .set('Cookie', adminCookie)
        .attach('file', makeWebmBuffer(), { filename: 'clip.webm', contentType: 'video/webm' })
        .expect(201);
      expect(res.body.data.type).toBe('VIDEO');
      expect(res.body.data.status).toBe('PROCESSING');
      expect(res.body.data.mimeType).toBe('video/webm');
      createdVideoIds.push(res.body.data.id);
    });
  });

  // ── Admin signed-URL endpoint ─────────────────────────────────────────────

  describe('GET /v1/admin/assets/:id/original-url', () => {
    it('200 — returns { url, expiresAt } for an asset with originalStoragePath', async () => {
      const res = await api()
        .get(`/v1/admin/assets/${assetWithOriginalId}/original-url`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(typeof res.body.data.url).toBe('string');
      expect(res.body.data.url.length).toBeGreaterThan(0);
      const expMs = new Date(res.body.data.expiresAt).getTime();
      expect(expMs).toBeGreaterThan(Date.now());
      // 5-min TTL ± some slack for clock drift
      expect(expMs).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 5000);
    });

    it('404 — when originalStoragePath is NULL (post-deletion)', () => {
      return api()
        .get(`/v1/admin/assets/${assetWithoutOriginalId}/original-url`)
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('404 — when the asset row does not exist', () => {
      return api()
        .get(`/v1/admin/assets/${crypto.randomUUID()}/original-url`)
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('401 — unauthenticated request rejected', () => {
      return api().get(`/v1/admin/assets/${assetWithOriginalId}/original-url`).expect(401);
    });

    it('403 — customer session without assets:view rejected', () => {
      return api()
        .get(`/v1/admin/assets/${assetWithOriginalId}/original-url`)
        .set('Cookie', customerCookie)
        .expect(403);
    });
  });
});
