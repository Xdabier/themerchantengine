import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { ConfigService } from '@nestjs/config';
import { SeoSubmitOrchestrator } from './seo-submit.orchestrator';
import type { SeoProductsReader } from './seo-submit.orchestrator';
import {
  IdempotencyKeyConflictException,
  IdempotencyKeyForbiddenException,
} from '../../common/exceptions/idempotency.exception';
import {
  SeoForeignUrlException,
  SeoMultipleTargetsException,
  SeoNoApplicableEngineException,
  SeoNoTargetException,
} from './seo-submit.exceptions';

const SITE = 'https://atlas.example';

type SubmitMock = {
  submitToIndexNow: jest.Mock;
  submitToGsc: jest.Mock;
  submitToBing: jest.Mock;
  previewIndexNowDedup: jest.Mock;
};

function makeMocks() {
  const submit: SubmitMock = {
    submitToIndexNow: jest.fn().mockResolvedValue({ accepted: true, submitted: 1 }),
    submitToGsc: jest.fn().mockResolvedValue({ accepted: true, submitted: 1 }),
    submitToBing: jest.fn().mockResolvedValue({ accepted: true, submitted: 1 }),
    previewIndexNowDedup: jest.fn().mockResolvedValue({ fresh: 0, deduped: 0 }),
  };
  const submissions = { recordEngineResult: jest.fn().mockResolvedValue('sub_1') };
  const config = {
    get: jest.fn((key: string) => (key === 'STOREFRONT_PUBLIC_BASE_URL' ? SITE : undefined)),
  } as unknown as ConfigService;
  const idempotency = {
    beginRequest: jest.fn().mockResolvedValue({ state: 'fresh' }),
    completeRequest: jest.fn().mockResolvedValue(undefined),
    abortRequest: jest.fn().mockResolvedValue(undefined),
  };
  const products: jest.Mocked<SeoProductsReader> = {
    resolveActivePublicSlugs: jest.fn().mockResolvedValue([]),
    // D5 widened the reader interface; the orchestrator never calls this, but the
    // mock must satisfy the type.
    listRecentlyUpdatedActiveSlugs: jest.fn().mockResolvedValue([]),
  };
  const orchestrator = new SeoSubmitOrchestrator(
    submit as never,
    submissions as never,
    config,
    idempotency as never,
    products,
  );
  return { orchestrator, submit, submissions, idempotency, products };
}

const ACTOR = 'user_1';
const KEY = 'idem-key-1';

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('SeoSubmitOrchestrator', () => {
  describe('target resolution', () => {
    it('throws SeoNoTargetException when no target is given', async () => {
      const { orchestrator, submit } = makeMocks();
      await expect(orchestrator.submitManual({}, ACTOR, KEY, 'req-1')).rejects.toBeInstanceOf(
        SeoNoTargetException,
      );
      expect(submit.submitToIndexNow).not.toHaveBeenCalled();
    });

    it('throws SeoMultipleTargetsException when more than one target is given', async () => {
      const { orchestrator } = makeMocks();
      await expect(
        orchestrator.submitManual({ url: `${SITE}/en/x`, sitemap: true }, ACTOR, KEY, 'req-1'),
      ).rejects.toBeInstanceOf(SeoMultipleTargetsException);
    });

    it('rejects a foreign-origin url with SeoForeignUrlException and submits nothing', async () => {
      const { orchestrator, submit } = makeMocks();
      await expect(
        orchestrator.submitManual({ url: 'https://evil.com/x' }, ACTOR, KEY, 'req-1'),
      ).rejects.toBeInstanceOf(SeoForeignUrlException);
      expect(submit.submitToIndexNow).not.toHaveBeenCalled();
    });
  });

  describe('url target', () => {
    it('submits the single URL to IndexNow only and records one manual row', async () => {
      const { orchestrator, submit, submissions } = makeMocks();
      const url = `${SITE}/en/catalog/product/widget`;
      const res = await orchestrator.submitManual({ url }, ACTOR, KEY, 'req-1');

      expect(submit.submitToIndexNow).toHaveBeenCalledWith([url], SITE);
      expect(submit.submitToGsc).not.toHaveBeenCalled();
      expect(submit.submitToBing).not.toHaveBeenCalled();
      expect(submissions.recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'manual',
          actorId: ACTOR,
          targetType: 'url',
          engine: 'indexnow',
        }),
      );
      expect(res).toMatchObject({
        dryRun: false,
        targetType: 'url',
        requestedCount: 1,
        results: [
          {
            engine: 'indexnow',
            accepted: true,
            submitted: 1,
            skippedDeduped: 0,
            submissionId: 'sub_1',
          },
        ],
      });
    });
  });

  describe('products target', () => {
    it('expands resolved slugs to locale-prefixed URLs and submits to IndexNow', async () => {
      const { orchestrator, submit, products } = makeMocks();
      products.resolveActivePublicSlugs.mockResolvedValueOnce([
        { id: 'p1', slug: 'alpha' },
        { id: 'p2', slug: 'beta' },
      ]);
      submit.submitToIndexNow.mockResolvedValueOnce({ accepted: true, submitted: 4 });

      const res = await orchestrator.submitManual(
        { productIds: ['p1', 'p2'] },
        ACTOR,
        KEY,
        'req-1',
      );

      expect(products.resolveActivePublicSlugs).toHaveBeenCalledWith(['p1', 'p2']);
      expect(submit.submitToIndexNow).toHaveBeenCalledWith(
        [
          `${SITE}/fr/catalog/product/alpha`,
          `${SITE}/en/catalog/product/alpha`,
          `${SITE}/fr/catalog/product/beta`,
          `${SITE}/en/catalog/product/beta`,
        ],
        SITE,
      );
      expect(res.requestedCount).toBe(4);
    });

    it('still records a row with requestedCount 0 when no ids resolve (all unknown/draft)', async () => {
      const { orchestrator, submit, submissions } = makeMocks();
      // resolveActivePublicSlugs defaults to [] → no URLs.
      submit.submitToIndexNow.mockResolvedValueOnce({ accepted: true, submitted: 0 });
      const res = await orchestrator.submitManual({ productIds: ['nope'] }, ACTOR, KEY, 'req-1');

      expect(submit.submitToIndexNow).toHaveBeenCalledWith([], SITE);
      expect(submissions.recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({ requestedCount: 0, engine: 'indexnow' }),
      );
      expect(res.requestedCount).toBe(0);
    });

    it('derives skippedDeduped = requested − submitted for an accepted IndexNow result', async () => {
      const { orchestrator, submit, products } = makeMocks();
      products.resolveActivePublicSlugs.mockResolvedValueOnce([
        { id: 'p1', slug: 'a' },
        { id: 'p2', slug: 'b' },
        { id: 'p3', slug: 'c' },
      ]);
      submit.submitToIndexNow.mockResolvedValueOnce({ accepted: true, submitted: 2 });

      const res = await orchestrator.submitManual(
        { productIds: ['p1', 'p2', 'p3'] },
        ACTOR,
        KEY,
        'req-1',
      );
      expect(res.results[0].skippedDeduped).toBe(4); // 6 urls requested − 2 submitted
    });
  });

  describe('sitemap target', () => {
    it('submits the sitemap to GSC + Bing, never IndexNow', async () => {
      const { orchestrator, submit } = makeMocks();
      const res = await orchestrator.submitManual({ sitemap: true }, ACTOR, KEY, 'req-1');

      const feed = `${SITE}/sitemap_index.xml`;
      expect(submit.submitToGsc).toHaveBeenCalledWith(feed);
      expect(submit.submitToBing).toHaveBeenCalledWith(feed);
      expect(submit.submitToIndexNow).not.toHaveBeenCalled();
      expect(res.results.map((r) => r.engine)).toEqual(['gsc', 'bing']);
    });
  });

  describe('engine narrowing', () => {
    it('narrows to the requested applicable subset (sitemap + engines:[gsc] → GSC only)', async () => {
      const { orchestrator, submit } = makeMocks();
      const res = await orchestrator.submitManual(
        { sitemap: true, engines: ['gsc'] },
        ACTOR,
        KEY,
        'req-1',
      );
      expect(submit.submitToGsc).toHaveBeenCalledTimes(1);
      expect(submit.submitToBing).not.toHaveBeenCalled();
      expect(res.results.map((r) => r.engine)).toEqual(['gsc']);
    });

    it('throws SeoNoApplicableEngineException when the narrowed set is empty (url + engines:[gsc])', async () => {
      const { orchestrator, submit } = makeMocks();
      await expect(
        orchestrator.submitManual({ url: `${SITE}/en/x`, engines: ['gsc'] }, ACTOR, KEY, 'req-1'),
      ).rejects.toBeInstanceOf(SeoNoApplicableEngineException);
      expect(submit.submitToGsc).not.toHaveBeenCalled();
      expect(submit.submitToIndexNow).not.toHaveBeenCalled();
    });
  });

  describe('dryRun', () => {
    it('previews IndexNow dedup without submitting, recording, or claiming idempotency', async () => {
      const { orchestrator, submit, submissions, idempotency, products } = makeMocks();
      products.resolveActivePublicSlugs.mockResolvedValueOnce([{ id: 'p1', slug: 'alpha' }]);
      submit.previewIndexNowDedup.mockResolvedValueOnce({ fresh: 2, deduped: 0 });

      const res = await orchestrator.submitManual(
        { productIds: ['p1'], dryRun: true },
        ACTOR,
        KEY,
        'req-1',
      );

      expect(submit.submitToIndexNow).not.toHaveBeenCalled();
      expect(submissions.recordEngineResult).not.toHaveBeenCalled();
      expect(idempotency.beginRequest).not.toHaveBeenCalled();
      expect(res).toMatchObject({
        dryRun: true,
        targetType: 'products',
        results: [
          {
            engine: 'indexnow',
            submitted: 2,
            skippedDeduped: 0,
            reason: 'dry run',
            submissionId: null,
          },
        ],
      });
    });

    it('previews a sitemap dryRun as gsc + bing without engine calls', async () => {
      const { orchestrator, submit } = makeMocks();
      const res = await orchestrator.submitManual(
        { sitemap: true, dryRun: true },
        ACTOR,
        KEY,
        'req-1',
      );
      expect(submit.submitToGsc).not.toHaveBeenCalled();
      expect(submit.submitToBing).not.toHaveBeenCalled();
      expect(res.results.map((r) => r.engine)).toEqual(['gsc', 'bing']);
      expect(res.results.every((r) => r.reason === 'dry run')).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('returns the cached response verbatim without calling any engine', async () => {
      const { orchestrator, submit, submissions, idempotency } = makeMocks();
      const cached = { dryRun: false, targetType: 'sitemap', requestedCount: 1, results: [] };
      idempotency.beginRequest.mockResolvedValueOnce({ state: 'cached', cachedResponse: cached });

      const res = await orchestrator.submitManual({ sitemap: true }, ACTOR, KEY, 'req-1');
      expect(res).toBe(cached);
      expect(submit.submitToGsc).not.toHaveBeenCalled();
      expect(submissions.recordEngineResult).not.toHaveBeenCalled();
    });

    it('throws 409 on a body conflict', async () => {
      const { orchestrator, idempotency } = makeMocks();
      idempotency.beginRequest.mockResolvedValueOnce({ state: 'conflict' });
      await expect(
        orchestrator.submitManual({ sitemap: true }, ACTOR, KEY, 'req-1'),
      ).rejects.toBeInstanceOf(IdempotencyKeyConflictException);
    });

    it('throws 409 on an in-flight replay', async () => {
      const { orchestrator, idempotency } = makeMocks();
      idempotency.beginRequest.mockResolvedValueOnce({ state: 'in-flight' });
      await expect(
        orchestrator.submitManual({ sitemap: true }, ACTOR, KEY, 'req-1'),
      ).rejects.toBeInstanceOf(IdempotencyKeyConflictException);
    });

    it('throws 403 on a caller mismatch', async () => {
      const { orchestrator, idempotency } = makeMocks();
      idempotency.beginRequest.mockResolvedValueOnce({ state: 'forbidden' });
      await expect(
        orchestrator.submitManual({ sitemap: true }, ACTOR, KEY, 'req-1'),
      ).rejects.toBeInstanceOf(IdempotencyKeyForbiddenException);
    });

    it('persists the response on a fresh success so a replay can be served', async () => {
      const { orchestrator, idempotency } = makeMocks();
      const res = await orchestrator.submitManual({ sitemap: true }, ACTOR, KEY, 'req-1');
      expect(idempotency.completeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ key: KEY, responseJson: res }),
      );
    });
  });

  describe('reason safety', () => {
    it('passes the raw engine reason through unchanged (no stack/body appended)', async () => {
      const { orchestrator, submit, submissions } = makeMocks();
      submit.submitToGsc.mockResolvedValueOnce({
        accepted: false,
        submitted: 0,
        reason: 'GSC submission error: invalid_grant',
      });
      submit.submitToBing.mockResolvedValueOnce({
        accepted: false,
        submitted: 0,
        reason: 'disabled',
      });

      const res = await orchestrator.submitManual(
        { sitemap: true, engines: ['gsc'] },
        ACTOR,
        KEY,
        'req-1',
      );
      expect(res.results[0].reason).toBe('GSC submission error: invalid_grant');
      expect(submissions.recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({ reason: 'GSC submission error: invalid_grant' }),
        }),
      );
    });
  });

  describe('failure + fallback paths', () => {
    it('aborts the idempotency claim and rethrows when an engine call throws unexpectedly', async () => {
      const { orchestrator, submit, idempotency } = makeMocks();
      submit.submitToGsc.mockRejectedValueOnce(new Error('unexpected'));
      await expect(
        orchestrator.submitManual({ sitemap: true }, ACTOR, KEY, 'req-1'),
      ).rejects.toThrow('unexpected');
      expect(idempotency.abortRequest).toHaveBeenCalledWith(expect.objectContaining({ key: KEY }));
      expect(idempotency.completeRequest).not.toHaveBeenCalled();
    });

    it('tolerates a fail-soft null submissionId and falls back to the correlationId for entityId', async () => {
      const { orchestrator, submissions, idempotency } = makeMocks();
      submissions.recordEngineResult.mockResolvedValueOnce(null); // DB hiccup → no row id
      const res = await orchestrator.submitManual({ url: `${SITE}/en/x` }, ACTOR, KEY, 'req-1');
      expect(res.results[0].submissionId).toBeNull();
      expect(idempotency.completeRequest).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'req-1' }),
      );
    });
  });
});
