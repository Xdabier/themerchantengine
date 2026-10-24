import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { SitemapProcessor } from './sitemap.processor';
import { SeoService } from '../seo.service';
import { SearchEngineSubmitService } from '../search-engine-submit.service';
import { SeoSubmissionService } from '../seo-submission.service';
import { SeoInsightsService } from '../seo-insights.service';

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('SitemapProcessor', () => {
  let processor: SitemapProcessor;
  let mockSeoService: jest.Mocked<SeoService>;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockSearchEngineSubmit: jest.Mocked<SearchEngineSubmitService>;
  let mockSeoSubmissions: jest.Mocked<SeoSubmissionService>;
  let mockQueue: jest.Mocked<Queue>;
  let mockInsights: { gscEnabled: jest.Mock; inspectUrl: jest.Mock };
  let mockProductsReader: {
    resolveActivePublicSlugs: jest.Mock;
    listRecentlyUpdatedActiveSlugs: jest.Mock;
  };

  beforeEach(() => {
    mockSeoService = {
      regenerateSitemaps: jest.fn().mockResolvedValue(undefined),
      setSubmissionHealth: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SeoService>;
    mockConfig = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === 'STOREFRONT_PUBLIC_BASE_URL') return 'https://atlas.example';
        return fallback;
      }),
    } as unknown as jest.Mocked<ConfigService>;
    mockSearchEngineSubmit = {
      submitToGsc: jest.fn().mockResolvedValue({ accepted: true, submitted: 1 }),
      submitToBing: jest
        .fn()
        .mockResolvedValue({ accepted: false, submitted: 0, reason: 'disabled' }),
      submitToIndexNow: jest.fn(),
      checkSubmissionHealth: jest.fn().mockResolvedValue({
        checkedAt: '2026-06-27T00:00:00.000Z',
        healthy: true,
        gsc: { state: 'ok', detail: '' },
        bing: { state: 'disabled', detail: '' },
        publicSitemap: { state: 'ok', detail: '' },
      }),
    } as unknown as jest.Mocked<SearchEngineSubmitService>;
    mockSeoSubmissions = {
      recordEngineResult: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SeoSubmissionService>;
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'cron-1' }),
    } as unknown as jest.Mocked<Queue>;
    mockInsights = {
      // GSC off by default — sweep tests that need it on flip this to true.
      gscEnabled: jest.fn().mockReturnValue(false),
      inspectUrl: jest.fn().mockResolvedValue({ state: 'disabled' }),
    };
    mockProductsReader = {
      resolveActivePublicSlugs: jest.fn().mockResolvedValue([]),
      listRecentlyUpdatedActiveSlugs: jest.fn().mockResolvedValue([]),
    };

    processor = new SitemapProcessor(
      mockSeoService,
      mockConfig,
      mockSearchEngineSubmit,
      mockSeoSubmissions,
      mockQueue,
      mockInsights as unknown as SeoInsightsService,
      mockProductsReader as never,
    );
  });

  describe('onModuleInit()', () => {
    it('registers the sitemap (6h) + submission-health (daily) + url-inspect sweep crons at boot', async () => {
      await processor.onModuleInit();
      expect(mockQueue.add).toHaveBeenCalledTimes(3);

      const [genName, , genOpts] = mockQueue.add.mock.calls[0];
      expect(genName).toBe('generate');
      expect(genOpts).toMatchObject({ repeat: { pattern: '0 */6 * * *' }, jobId: 'sitemap-cron' });

      const [healthName, , healthOpts] = mockQueue.add.mock.calls[1];
      expect(healthName).toBe('submission-health');
      expect(healthOpts).toMatchObject({
        repeat: { pattern: '30 6 * * *' },
        jobId: 'submission-health-cron',
      });

      const [sweepName, , sweepOpts] = mockQueue.add.mock.calls[2];
      expect(sweepName).toBe('url-inspect-sweep');
      expect(sweepOpts).toMatchObject({
        repeat: { pattern: '0 5 * * *' },
        jobId: 'url-inspect-sweep-cron',
      });
    });
  });

  describe('process()', () => {
    const fakeJob = { id: 'job-1' } as unknown as Job;

    it('calls SeoService.regenerateSitemaps with STOREFRONT_PUBLIC_BASE_URL', async () => {
      await processor.process(fakeJob);
      expect(mockSeoService.regenerateSitemaps).toHaveBeenCalledWith('https://atlas.example');
    });

    it('falls back to legacy SITE_URL when STOREFRONT_PUBLIC_BASE_URL is unset', async () => {
      (mockConfig.get as jest.Mock).mockImplementation((key: string, fallback?: string) => {
        if (key === 'SITE_URL') return 'https://legacy.test';
        return fallback;
      });
      await processor.process(fakeJob);
      expect(mockSeoService.regenerateSitemaps).toHaveBeenCalledWith('https://legacy.test');
    });

    it('calls submitToGsc with the absolute sitemap_index.xml URL after regen', async () => {
      await processor.process(fakeJob);
      expect(mockSearchEngineSubmit.submitToGsc).toHaveBeenCalledTimes(1);
      expect(mockSearchEngineSubmit.submitToGsc).toHaveBeenCalledWith(
        'https://atlas.example/sitemap_index.xml',
      );
    });

    it('still calls submitToGsc when GSC is disabled (env-gate lives inside the service)', async () => {
      mockSearchEngineSubmit.submitToGsc.mockResolvedValueOnce({
        accepted: false,
        submitted: 0,
        reason: 'disabled',
      });
      await processor.process(fakeJob);
      expect(mockSearchEngineSubmit.submitToGsc).toHaveBeenCalledTimes(1);
    });

    it('rethrows on regenerateSitemaps failure (BullMQ retries via defaultJobOptions)', async () => {
      mockSeoService.regenerateSitemaps.mockRejectedValueOnce(new Error('redis offline'));
      await expect(processor.process(fakeJob)).rejects.toThrow('redis offline');
      expect(mockSearchEngineSubmit.submitToGsc).not.toHaveBeenCalled();
    });

    it('does not throw when submitToGsc itself throws (defensive catch)', async () => {
      mockSearchEngineSubmit.submitToGsc.mockRejectedValueOnce(new Error('contract drift'));
      await expect(processor.process(fakeJob)).resolves.toBeUndefined();
    });

    it('submits to Bing after regen alongside GSC (DR-16)', async () => {
      await processor.process(fakeJob);
      expect(mockSearchEngineSubmit.submitToBing).toHaveBeenCalledWith(
        'https://atlas.example/sitemap_index.xml',
      );
    });

    it('does not throw when submitToBing itself throws (defensive catch)', async () => {
      mockSearchEngineSubmit.submitToBing.mockRejectedValueOnce(new Error('bing drift'));
      await expect(processor.process(fakeJob)).resolves.toBeUndefined();
    });

    it('records both engine attempts to the SeoSubmission audit log (DR-17)', async () => {
      // A non-repeatable job (no repeatJobKey / opts.repeat) is an event/ad-hoc
      // regen → auto-regen trigger.
      await processor.process(fakeJob);
      expect(mockSeoSubmissions.recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'auto-regen',
          engine: 'gsc',
          targetType: 'sitemap',
          targetRef: 'https://atlas.example/sitemap_index.xml',
          requestedCount: 1,
        }),
      );
      expect(mockSeoSubmissions.recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({ engine: 'bing', trigger: 'auto-regen' }),
      );
    });

    it('labels a scheduled (repeatable) sitemap submit as trigger:cron (DR-17)', async () => {
      // BullMQ gives repeatable iterations a runtime id like `repeat:<hash>:<ms>`
      // and sets repeatJobKey — the cron discriminator, NOT job.id === 'sitemap-cron'.
      const cronJob = {
        id: 'repeat:abc123:1782600000000',
        name: 'generate',
        repeatJobKey: 'seo-sitemap:generate::0 */6 * * *',
        opts: { repeat: { pattern: '0 */6 * * *' } },
      } as unknown as Job;
      await processor.process(cronJob);
      expect(mockSeoSubmissions.recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({ engine: 'gsc', trigger: 'cron' }),
      );
      expect(mockSeoSubmissions.recordEngineResult).toHaveBeenCalledWith(
        expect.objectContaining({ engine: 'bing', trigger: 'cron' }),
      );
    });

    it('runs the submission-health probe (not a regen) for the health job (DR-16)', async () => {
      const healthJob = { id: 'h-1', name: 'submission-health' } as unknown as Job;
      await processor.process(healthJob);
      expect(mockSeoService.regenerateSitemaps).not.toHaveBeenCalled();
      expect(mockSearchEngineSubmit.checkSubmissionHealth).toHaveBeenCalledWith(
        'https://atlas.example',
      );
      expect(mockSeoService.setSubmissionHealth).toHaveBeenCalled();
    });
  });

  describe('url-inspect sweep (DR-17 D5)', () => {
    const sweepJob = { id: 'sweep-1', name: 'url-inspect-sweep' } as unknown as Job;

    it('no-ops without inspecting when GSC is disabled', async () => {
      mockInsights.gscEnabled.mockReturnValue(false);
      await processor.process(sweepJob);
      expect(mockProductsReader.listRecentlyUpdatedActiveSlugs).not.toHaveBeenCalled();
      expect(mockInsights.inspectUrl).not.toHaveBeenCalled();
    });

    it('does not trigger a sitemap regen', async () => {
      mockInsights.gscEnabled.mockReturnValue(true);
      await processor.process(sweepJob);
      expect(mockSeoService.regenerateSitemaps).not.toHaveBeenCalled();
    });

    it('warms one default-locale URL per fresh product', async () => {
      mockInsights.gscEnabled.mockReturnValue(true);
      mockProductsReader.listRecentlyUpdatedActiveSlugs.mockResolvedValue([
        { id: 'p1', slug: 'honey', updatedAt: new Date('2026-06-28') },
        { id: 'p2', slug: 'serum', updatedAt: new Date('2026-06-27') },
        { id: 'p3', slug: 'wax', updatedAt: new Date('2026-06-26') },
      ]);
      mockInsights.inspectUrl.mockResolvedValue({ state: 'ok' });
      await processor.process(sweepJob);
      expect(mockInsights.inspectUrl).toHaveBeenCalledTimes(3);
      expect(mockInsights.inspectUrl).toHaveBeenNthCalledWith(1, {
        url: 'https://atlas.example/fr/catalog/product/honey',
      });
    });

    it('breaks early once the daily budget is exhausted', async () => {
      mockInsights.gscEnabled.mockReturnValue(true);
      mockProductsReader.listRecentlyUpdatedActiveSlugs.mockResolvedValue([
        { id: 'p1', slug: 'a', updatedAt: new Date() },
        { id: 'p2', slug: 'b', updatedAt: new Date() },
        { id: 'p3', slug: 'c', updatedAt: new Date() },
        { id: 'p4', slug: 'd', updatedAt: new Date() },
        { id: 'p5', slug: 'e', updatedAt: new Date() },
      ]);
      mockInsights.inspectUrl
        .mockResolvedValueOnce({ state: 'ok' })
        .mockResolvedValueOnce({ state: 'ok' })
        .mockResolvedValueOnce({ state: 'exhausted' });
      await processor.process(sweepJob);
      expect(mockInsights.inspectUrl).toHaveBeenCalledTimes(3); // stopped at the exhausted result
    });

    it('swallows a per-URL throw and keeps warming the rest', async () => {
      mockInsights.gscEnabled.mockReturnValue(true);
      mockProductsReader.listRecentlyUpdatedActiveSlugs.mockResolvedValue([
        { id: 'p1', slug: 'a', updatedAt: new Date() },
        { id: 'p2', slug: 'b', updatedAt: new Date() },
        { id: 'p3', slug: 'c', updatedAt: new Date() },
        { id: 'p4', slug: 'd', updatedAt: new Date() },
      ]);
      mockInsights.inspectUrl
        .mockResolvedValueOnce({ state: 'ok' })
        .mockRejectedValueOnce(new Error('gsc blip'))
        .mockResolvedValueOnce({ state: 'ok' })
        .mockResolvedValueOnce({ state: 'ok' });
      await expect(processor.process(sweepJob)).resolves.toBeUndefined();
      expect(mockInsights.inspectUrl).toHaveBeenCalledTimes(4);
    });
  });
});
