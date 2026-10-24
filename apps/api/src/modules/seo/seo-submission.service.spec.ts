import { SeoSubmissionService } from './seo-submission.service';
import { SEO_SUBMISSION_REASON_MAX } from './seo.constants';

type PrismaMock = {
  seoSubmission: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
};

function makePrisma(): PrismaMock {
  return {
    seoSubmission: {
      create: jest.fn().mockResolvedValue({ id: 'sub_1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

function makeService(prisma: PrismaMock): SeoSubmissionService {
  return new SeoSubmissionService(prisma as never);
}

describe('SeoSubmissionService', () => {
  describe('record', () => {
    it('persists one row with the mapped fields', async () => {
      const prisma = makePrisma();
      await makeService(prisma).record({
        actorId: 'user_1',
        trigger: 'manual',
        targetType: 'products',
        targetRef: '2 product(s)',
        engine: 'indexnow',
        requestedCount: 4,
        submittedCount: 4,
        skippedDeduped: 0,
        accepted: true,
        reason: null,
        correlationId: 'req-1',
      });
      expect(prisma.seoSubmission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 'user_1',
          trigger: 'manual',
          targetType: 'products',
          engine: 'indexnow',
          requestedCount: 4,
          submittedCount: 4,
          skippedDeduped: 0,
          accepted: true,
          reason: null,
          correlationId: 'req-1',
        }),
      });
    });

    it('defaults nullable fields (actorId, reason, correlationId, skippedDeduped)', async () => {
      const prisma = makePrisma();
      await makeService(prisma).record({
        trigger: 'cron',
        targetType: 'sitemap',
        targetRef: 'https://x/sitemap_index.xml',
        engine: 'gsc',
        requestedCount: 1,
        submittedCount: 1,
        accepted: true,
      });
      const data = prisma.seoSubmission.create.mock.calls[0][0].data;
      expect(data.actorId).toBeNull();
      expect(data.reason).toBeNull();
      expect(data.correlationId).toBeNull();
      expect(data.skippedDeduped).toBe(0);
    });

    it('truncates an over-long reason to the max', async () => {
      const prisma = makePrisma();
      const longReason = 'x'.repeat(SEO_SUBMISSION_REASON_MAX + 200);
      await makeService(prisma).record({
        trigger: 'cron',
        targetType: 'sitemap',
        targetRef: 'feed',
        engine: 'bing',
        requestedCount: 1,
        submittedCount: 0,
        accepted: false,
        reason: longReason,
      });
      const data = prisma.seoSubmission.create.mock.calls[0][0].data;
      expect(data.reason).toHaveLength(SEO_SUBMISSION_REASON_MAX);
    });

    it('is fail-soft — swallows a DB error and returns null instead of throwing', async () => {
      const prisma = makePrisma();
      prisma.seoSubmission.create.mockRejectedValueOnce(new Error('db down'));
      await expect(
        makeService(prisma).record({
          trigger: 'manual',
          targetType: 'url',
          targetRef: 'https://x/a',
          engine: 'indexnow',
          requestedCount: 1,
          submittedCount: 1,
          accepted: true,
        }),
      ).resolves.toBeNull();
    });

    it('returns the created row id on success (the per-engine submissionId)', async () => {
      const prisma = makePrisma();
      prisma.seoSubmission.create.mockResolvedValueOnce({ id: 'sub_42' });
      const id = await makeService(prisma).record({
        trigger: 'manual',
        targetType: 'url',
        targetRef: 'https://x/a',
        engine: 'indexnow',
        requestedCount: 1,
        submittedCount: 1,
        accepted: true,
      });
      expect(id).toBe('sub_42');
    });
  });

  describe('recordEngineResult', () => {
    it('derives dedup-skip = requested − submitted for an accepted IndexNow result', async () => {
      const prisma = makePrisma();
      await makeService(prisma).recordEngineResult({
        trigger: 'manual',
        targetType: 'products',
        targetRef: '6 url(s)',
        engine: 'indexnow',
        requestedCount: 6,
        result: { accepted: true, submitted: 2, reason: 'all URLs deduped (<5 min…)' },
      });
      const data = prisma.seoSubmission.create.mock.calls[0][0].data;
      expect(data.submittedCount).toBe(2);
      expect(data.skippedDeduped).toBe(4);
      expect(data.accepted).toBe(true);
    });

    it('does NOT count a shortfall as dedup on a rejected IndexNow result', async () => {
      const prisma = makePrisma();
      await makeService(prisma).recordEngineResult({
        trigger: 'manual',
        targetType: 'url',
        targetRef: 'https://x/a',
        engine: 'indexnow',
        requestedCount: 6,
        result: { accepted: false, submitted: 0, reason: 'IndexNow returned 429' },
      });
      const data = prisma.seoSubmission.create.mock.calls[0][0].data;
      expect(data.skippedDeduped).toBe(0);
      expect(data.accepted).toBe(false);
      expect(data.reason).toBe('IndexNow returned 429');
    });

    it('records gsc with zero dedup', async () => {
      const prisma = makePrisma();
      await makeService(prisma).recordEngineResult({
        trigger: 'cron',
        targetType: 'sitemap',
        targetRef: 'https://x/sitemap_index.xml',
        engine: 'gsc',
        requestedCount: 1,
        result: { accepted: true, submitted: 1 },
      });
      const data = prisma.seoSubmission.create.mock.calls[0][0].data;
      expect(data.engine).toBe('gsc');
      expect(data.skippedDeduped).toBe(0);
    });

    it('skips an automatic submission to a disabled engine (no audit-log spam)', async () => {
      const prisma = makePrisma();
      await makeService(prisma).recordEngineResult({
        trigger: 'auto-regen',
        targetType: 'sitemap',
        targetRef: 'feed',
        engine: 'bing',
        requestedCount: 1,
        result: { accepted: false, submitted: 0, reason: 'disabled' },
      });
      expect(prisma.seoSubmission.create).not.toHaveBeenCalled();
    });

    it('skips an automatic submission when the engine config is unset', async () => {
      const prisma = makePrisma();
      await makeService(prisma).recordEngineResult({
        trigger: 'cron',
        targetType: 'sitemap',
        targetRef: 'feed',
        engine: 'gsc',
        requestedCount: 1,
        result: { accepted: false, submitted: 0, reason: 'GSC_SITE_URL unset' },
      });
      expect(prisma.seoSubmission.create).not.toHaveBeenCalled();
    });

    it('ALWAYS records a manual submission, even to a disabled engine', async () => {
      const prisma = makePrisma();
      await makeService(prisma).recordEngineResult({
        actorId: 'user_1',
        trigger: 'manual',
        targetType: 'sitemap',
        targetRef: 'feed',
        engine: 'bing',
        requestedCount: 1,
        result: { accepted: false, submitted: 0, reason: 'disabled' },
      });
      expect(prisma.seoSubmission.create).toHaveBeenCalledTimes(1);
      const data = prisma.seoSubmission.create.mock.calls[0][0].data;
      expect(data.reason).toBe('disabled');
    });
  });

  describe('list', () => {
    it('builds the where filter, paginates, and returns data + meta', async () => {
      const prisma = makePrisma();
      prisma.seoSubmission.findMany.mockResolvedValueOnce([{ id: 'sub_1' }]);
      prisma.seoSubmission.count.mockResolvedValueOnce(1);
      const res = await makeService(prisma).list({
        page: 2,
        pageSize: 10,
        engine: 'bing',
        trigger: 'manual',
        targetType: 'sitemap',
        accepted: false,
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-27T00:00:00.000Z',
      });
      const args = prisma.seoSubmission.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        engine: 'bing',
        trigger: 'manual',
        targetType: 'sitemap',
        accepted: false,
        createdAt: {
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lte: new Date('2026-06-27T00:00:00.000Z'),
        },
      });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
      expect(res).toEqual({ data: [{ id: 'sub_1' }], meta: { page: 2, pageSize: 10, total: 1 } });
    });

    it('defaults page/pageSize/sort when omitted', async () => {
      const prisma = makePrisma();
      await makeService(prisma).list({});
      const args = prisma.seoSubmission.findMany.mock.calls[0][0];
      expect(args.where).toEqual({});
      expect(args.skip).toBe(0);
      expect(args.take).toBe(20);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });
  });
});
