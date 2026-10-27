import { FR_EN_LOCALE_SET, NEUTRAL_LOCALE_SET, storeLocales } from '@common/locale';
import type Redis from 'ioredis';
import type { ConfigService } from '@nestjs/config';
import { SeoInsightsService } from './seo-insights.service';
import type { SearchEngineSubmitService, SubmissionHealth } from './search-engine-submit.service';
import type { SeoService } from './seo.service';
import {
  SEO_ANALYTICS_CACHE_PREFIX,
  SEO_BING_QUOTA_CACHE_KEY,
  SEO_COVERAGE_CACHE_KEY,
  SEO_GSC_INSPECT_BUDGET_PREFIX,
  SEO_GSC_INSPECT_DAILY_CAP,
  SEO_INSPECT_CACHE_PREFIX,
} from './seo.constants';

// Mock googleapis at module scope so the GSC client the SUT constructs picks up the mock.
const mockSitemapsList = jest.fn();
const mockSearchAnalyticsQuery = jest.fn();
const mockUrlInspect = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn().mockImplementation(() => ({})) },
    searchconsole: jest.fn().mockImplementation(() => ({
      sitemaps: { list: (...args: unknown[]) => mockSitemapsList(...args) },
      searchanalytics: { query: (...args: unknown[]) => mockSearchAnalyticsQuery(...args) },
      urlInspection: { index: { inspect: (...args: unknown[]) => mockUrlInspect(...args) } },
    })),
  },
}));

type RedisGet = (key: string) => string | null;

beforeEach(() => storeLocales.set(FR_EN_LOCALE_SET));
afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

describe('SeoInsightsService', () => {
  let redis: {
    get: jest.Mock;
    setex: jest.Mock;
    incr: jest.Mock;
    decr: jest.Mock;
    expire: jest.Mock;
  };
  let submit: { checkSubmissionHealth: jest.Mock };
  let seo: { setSubmissionHealth: jest.Mock };
  let config: { get: jest.Mock };
  let products: {
    resolveActivePublicSlugs: jest.Mock;
    listRecentlyUpdatedActiveSlugs: jest.Mock;
  };
  let service: SeoInsightsService;
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;

  /** Build the SUT with a Redis `get` keyed per cache key. */
  const build = (getImpl: RedisGet = () => null) => {
    redis = {
      get: jest.fn((k: string) => Promise.resolve(getImpl(k))),
      setex: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn().mockResolvedValue(1),
      decr: jest.fn().mockResolvedValue(0),
      expire: jest.fn().mockResolvedValue(1),
    };
    submit = { checkSubmissionHealth: jest.fn() };
    seo = { setSubmissionHealth: jest.fn().mockResolvedValue(undefined) };
    config = {
      get: jest.fn((k: string) =>
        k === 'STOREFRONT_PUBLIC_BASE_URL' ? 'https://atlas.example' : undefined,
      ),
    };
    products = {
      resolveActivePublicSlugs: jest.fn().mockResolvedValue([]),
      listRecentlyUpdatedActiveSlugs: jest.fn().mockResolvedValue([]),
    };
    service = new SeoInsightsService(
      redis as unknown as Redis,
      submit as unknown as SearchEngineSubmitService,
      seo as unknown as SeoService,
      config as unknown as ConfigService,
      products as never,
    );
  };

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    mockSitemapsList.mockReset();
    mockSearchAnalyticsQuery.mockReset();
    mockUrlInspect.mockReset();
    // Engines disabled by default; each test enables what it needs.
    delete process.env.GSC_SUBMISSION_ENABLED;
    delete process.env.GSC_SITE_URL;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.BING_API_KEY;
    delete process.env.BING_SITE_URL;
    delete process.env.STOREFRONT_PUBLIC_BASE_URL;
    build();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  const enableGsc = () => {
    process.env.GSC_SUBMISSION_ENABLED = 'true';
    process.env.GSC_SITE_URL = 'sc-domain:atlas.example';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/etc/gsc/sa.json';
  };

  const SAME_ORIGIN_URL = 'https://atlas.example/en/catalog/product/honey';
  const okInspectResult = {
    data: {
      inspectionResult: {
        indexStatusResult: {
          verdict: 'PASS',
          coverageState: 'Submitted and indexed',
          indexingState: 'INDEXING_ALLOWED',
          robotsTxtState: 'ALLOWED',
          pageFetchState: 'SUCCESSFUL',
          lastCrawlTime: '2026-06-27T10:00:00Z',
          googleCanonical: SAME_ORIGIN_URL,
          userCanonical: SAME_ORIGIN_URL,
        },
      },
    },
  };

  // ── inspectUrl() ────────────────────────────────────────────────────────────

  describe('inspectUrl()', () => {
    it('returns the cached snapshot without an INCR or a GSC call (cache hit)', async () => {
      enableGsc();
      const cached = { state: 'ok', detail: 'PASS', url: SAME_ORIGIN_URL, verdict: 'PASS' };
      build((k) => (k.startsWith(SEO_INSPECT_CACHE_PREFIX) ? JSON.stringify(cached) : null));
      const res = await service.inspectUrl({ url: SAME_ORIGIN_URL });
      expect(res).toEqual(cached);
      expect(mockUrlInspect).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('returns state:disabled (no client, no spend) when GSC is off', async () => {
      // GSC disabled by default in beforeEach.
      const res = await service.inspectUrl({ url: SAME_ORIGIN_URL });
      expect(res.state).toBe('disabled');
      expect(mockUrlInspect).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('returns state:error for a foreign-origin URL without spending budget', async () => {
      enableGsc();
      build();
      const res = await service.inspectUrl({ url: 'https://evil.example/en/catalog/product/x' });
      expect(res.state).toBe('error');
      expect(res.url).toBeNull();
      expect(redis.incr).not.toHaveBeenCalled();
      expect(mockUrlInspect).not.toHaveBeenCalled();
    });

    it('returns state:exhausted (no GSC call, slot released) when the reservation is over the cap', async () => {
      enableGsc();
      build();
      // The atomic INCR is the gate: an over-cap reservation (cap+1) refuses + DECRs.
      redis.incr.mockResolvedValue(SEO_GSC_INSPECT_DAILY_CAP + 1);
      const res = await service.inspectUrl({ url: SAME_ORIGIN_URL });
      expect(res.state).toBe('exhausted');
      expect(res.inspectUsed).toBe(SEO_GSC_INSPECT_DAILY_CAP);
      expect(res.inspectCap).toBe(SEO_GSC_INSPECT_DAILY_CAP);
      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.decr).toHaveBeenCalledTimes(1); // released so the counter stays bounded
      expect(mockUrlInspect).not.toHaveBeenCalled();
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('reserves a slot (INCR), calls GSC, maps the safe fields, and write-through caches', async () => {
      enableGsc();
      build((k) => (k.startsWith(SEO_GSC_INSPECT_BUDGET_PREFIX) ? '5' : null));
      redis.incr.mockResolvedValue(6); // not the first of the day
      mockUrlInspect.mockResolvedValue(okInspectResult);

      const res = await service.inspectUrl({ url: SAME_ORIGIN_URL });

      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.incr.mock.calls[0][0]).toMatch(
        new RegExp(`^${SEO_GSC_INSPECT_BUDGET_PREFIX}\\d{8}$`),
      );
      expect(mockUrlInspect).toHaveBeenCalledWith({
        requestBody: { inspectionUrl: SAME_ORIGIN_URL, siteUrl: 'sc-domain:atlas.example' },
      });
      expect(res.state).toBe('ok');
      expect(res.verdict).toBe('PASS');
      expect(res.coverageState).toBe('Submitted and indexed');
      expect(res.lastCrawlTime).toBe('2026-06-27T10:00:00Z');
      // Only the safe verdict fields — never the raw inspectionResult body.
      expect(JSON.stringify(res)).not.toContain('inspectionResult');
      expect(redis.setex).toHaveBeenCalledWith(
        `${SEO_INSPECT_CACHE_PREFIX}${SAME_ORIGIN_URL}`,
        24 * 60 * 60,
        expect.any(String),
      );
    });

    it('sets a midnight-PT TTL on the first INCR of the day', async () => {
      enableGsc();
      build();
      redis.incr.mockResolvedValue(1); // first inspection of the PT day
      mockUrlInspect.mockResolvedValue(okInspectResult);

      await service.inspectUrl({ url: SAME_ORIGIN_URL });

      expect(redis.expire).toHaveBeenCalledTimes(1);
      const [, ttl] = redis.expire.mock.calls[0];
      expect(typeof ttl).toBe('number');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86_400);
    });

    it('returns state:error (uncached) when the GSC call throws, slot already reserved', async () => {
      enableGsc();
      build((k) => (k.startsWith(SEO_GSC_INSPECT_BUDGET_PREFIX) ? '10' : null));
      redis.incr.mockResolvedValue(11);
      mockUrlInspect.mockRejectedValue(new Error('quota exceeded'));

      const res = await service.inspectUrl({ url: SAME_ORIGIN_URL });

      expect(res.state).toBe('error');
      expect(redis.incr).toHaveBeenCalledTimes(1); // slot reserved (conservative)
      expect(redis.setex).not.toHaveBeenCalled(); // transient failure not frozen
    });

    it('resolves a productId to its default-locale (fr) storefront URL', async () => {
      enableGsc();
      build();
      products.resolveActivePublicSlugs.mockResolvedValue([{ id: 'p1', slug: 'sidr-honey' }]);
      mockUrlInspect.mockResolvedValue(okInspectResult);

      await service.inspectUrl({ productId: 'p1' });

      expect(products.resolveActivePublicSlugs).toHaveBeenCalledWith(['p1']);
      expect(mockUrlInspect.mock.calls[0][0].requestBody.inspectionUrl).toBe(
        'https://atlas.example/fr/catalog/product/sidr-honey',
      );
    });

    it('resolves a productId with an explicit en locale', async () => {
      enableGsc();
      build();
      products.resolveActivePublicSlugs.mockResolvedValue([{ id: 'p1', slug: 'sidr-honey' }]);
      mockUrlInspect.mockResolvedValue(okInspectResult);

      await service.inspectUrl({ productId: 'p1', locale: 'en' });

      expect(mockUrlInspect.mock.calls[0][0].requestBody.inspectionUrl).toBe(
        'https://atlas.example/en/catalog/product/sidr-honey',
      );
    });

    it('returns state:error (no spend) when the productId is unknown/inactive', async () => {
      enableGsc();
      build();
      products.resolveActivePublicSlugs.mockResolvedValue([]); // dropped — not ACTIVE/known
      const res = await service.inspectUrl({ productId: 'ghost' });
      expect(res.state).toBe('error');
      expect(redis.incr).not.toHaveBeenCalled();
      expect(mockUrlInspect).not.toHaveBeenCalled();
    });

    it('throws SeoNoInspectTargetException when neither url nor productId is given', async () => {
      enableGsc();
      build();
      await expect(service.inspectUrl({})).rejects.toMatchObject({
        response: { error: { code: 'SEO_NO_INSPECT_TARGET' } },
      });
    });

    it('throws SeoMultipleInspectTargetsException when both url and productId are given', async () => {
      enableGsc();
      build();
      await expect(
        service.inspectUrl({ url: SAME_ORIGIN_URL, productId: 'p1' }),
      ).rejects.toMatchObject({ response: { error: { code: 'SEO_MULTIPLE_INSPECT_TARGETS' } } });
    });
  });

  // ── getSitemapCoverage() ────────────────────────────────────────────────────

  describe('getSitemapCoverage()', () => {
    it('reports GSC ok and sums contents[].submitted per sitemap', async () => {
      enableGsc();
      build();
      mockSitemapsList.mockResolvedValue({
        data: {
          sitemap: [
            {
              path: 'https://atlas.example/sitemap-products.xml',
              lastDownloaded: '2026-06-27T00:00:00.000Z',
              errors: '0',
              warnings: '2',
              isPending: false,
              contents: [{ type: 'web', submitted: '120' }],
            },
          ],
        },
      });

      const cov = await service.getSitemapCoverage();

      expect(cov.gsc.state).toBe('ok');
      expect(cov.gsc.sitemaps).toEqual([
        {
          path: 'https://atlas.example/sitemap-products.xml',
          submitted: 120,
          lastDownloaded: '2026-06-27T00:00:00.000Z',
          errors: 0,
          warnings: 2,
          isPending: false,
        },
      ]);
      // Coverage write-through cache populated.
      expect(redis.setex).toHaveBeenCalledWith(
        SEO_COVERAGE_CACHE_KEY,
        expect.any(Number),
        expect.any(String),
      );
    });

    it('reports GSC disabled without constructing a client when GSC is off', async () => {
      const cov = await service.getSitemapCoverage();
      expect(cov.gsc.state).toBe('disabled');
      expect(cov.gsc.sitemaps).toEqual([]);
      expect(mockSitemapsList).not.toHaveBeenCalled();
    });

    it('reports GSC error (no throw) when sitemaps.list rejects', async () => {
      enableGsc();
      build();
      mockSitemapsList.mockRejectedValue(new Error('insufficient permission'));
      const cov = await service.getSitemapCoverage();
      expect(cov.gsc.state).toBe('error');
      expect(cov.gsc.detail).toContain('insufficient permission');
      expect(cov.gsc.sitemaps).toEqual([]);
    });

    it('reports Bing ok and maps GetFeeds d[] entries', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      build();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: () =>
          Promise.resolve({
            d: [
              {
                Url: 'https://atlas.example/sitemap_index.xml',
                LastCrawled: '2026-06-26T10:00:00Z',
                UrlCount: 134,
              },
            ],
          }),
      }) as unknown as typeof fetch;

      const cov = await service.getSitemapCoverage();
      expect(cov.bing.state).toBe('ok');
      expect(cov.bing.feeds).toEqual([
        {
          url: 'https://atlas.example/sitemap_index.xml',
          lastCrawled: '2026-06-26T10:00:00Z',
          urlCount: 134,
        },
      ]);
    });

    it('reports Bing disabled when BING_API_KEY is unset', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const cov = await service.getSitemapCoverage();
      expect(cov.bing.state).toBe('disabled');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports Bing error when the site URL (and fallback) are unset', async () => {
      process.env.BING_API_KEY = 'bkey';
      // BING_SITE_URL + STOREFRONT_PUBLIC_BASE_URL both unset (cleared in beforeEach).
      build();
      const cov = await service.getSitemapCoverage();
      expect(cov.bing.state).toBe('error');
      expect(cov.bing.detail).toContain('BING_SITE_URL');
    });

    it('reports Bing error on a non-200 GetFeeds response', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      build();
      global.fetch = jest.fn().mockResolvedValue({
        status: 403,
        json: () => Promise.resolve({}),
      }) as unknown as typeof fetch;
      const cov = await service.getSitemapCoverage();
      expect(cov.bing.state).toBe('error');
      expect(cov.bing.detail).toContain('403');
    });

    it('reports Bing error when GetFeeds throws', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      build();
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
      const cov = await service.getSitemapCoverage();
      expect(cov.bing.state).toBe('error');
      expect(cov.bing.detail).toContain('ECONNRESET');
    });

    it('does NOT cache a coverage snapshot when an engine probe errored', async () => {
      enableGsc();
      build();
      mockSitemapsList.mockRejectedValue(new Error('boom')); // gsc → error
      const cov = await service.getSitemapCoverage();
      expect(cov.gsc.state).toBe('error');
      // A transient error must not be frozen into the 6 h cache.
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('returns the cached snapshot without probing any engine on a cache hit', async () => {
      const snapshot = {
        gsc: { state: 'ok', detail: '1 sitemap(s)', sitemaps: [] },
        bing: { state: 'disabled', detail: 'BING_API_KEY unset', feeds: [] },
      };
      build((k) => (k === SEO_COVERAGE_CACHE_KEY ? JSON.stringify(snapshot) : null));
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const cov = await service.getSitemapCoverage();
      expect(cov).toEqual(snapshot);
      expect(mockSitemapsList).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── getQuota() ──────────────────────────────────────────────────────────────

  describe('getQuota()', () => {
    it('reads Bing quota live (never assumes 10 000) and caches it', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      build();
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ d: { DailyQuota: 5, MonthlyQuota: 120 } }),
      }) as unknown as typeof fetch;

      const q = await service.getQuota();
      // Adaptive quota — a single-digit daily value must survive verbatim.
      expect(q.bing.state).toBe('ok');
      expect(q.bing.dailyQuota).toBe(5);
      expect(q.bing.monthlyQuota).toBe(120);
      expect(redis.setex).toHaveBeenCalledWith(
        SEO_BING_QUOTA_CACHE_KEY,
        expect.any(Number),
        expect.any(String),
      );
    });

    it('reports Bing quota disabled when BING_API_KEY is unset', async () => {
      const q = await service.getQuota();
      expect(q.bing.state).toBe('disabled');
      expect(q.bing.dailyQuota).toBeNull();
      expect(q.bing.monthlyQuota).toBeNull();
    });

    it('reports Bing quota error when the site URL is unset', async () => {
      process.env.BING_API_KEY = 'bkey';
      build();
      const q = await service.getQuota();
      expect(q.bing.state).toBe('error');
      expect(q.bing.detail).toContain('BING_SITE_URL');
    });

    it('reports Bing quota error on a non-200 response', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      build();
      global.fetch = jest.fn().mockResolvedValue({
        status: 500,
        json: () => Promise.resolve({}),
      }) as unknown as typeof fetch;
      const q = await service.getQuota();
      expect(q.bing.state).toBe('error');
      expect(q.bing.detail).toContain('500');
    });

    it('reports Bing quota error when the request throws', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      build();
      global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as unknown as typeof fetch;
      const q = await service.getQuota();
      expect(q.bing.state).toBe('error');
      expect(q.bing.detail).toContain('ETIMEDOUT');
    });

    it('serves Bing quota from cache without a network call on a cache hit', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      const cached = { state: 'ok', detail: 'live', dailyQuota: 9000, monthlyQuota: 250000 };
      build((k) => (k === SEO_BING_QUOTA_CACHE_KEY ? JSON.stringify(cached) : null));
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const q = await service.getQuota();
      expect(q.bing).toEqual(cached);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads the GSC inspect-budget counter for the PT day when GSC is enabled', async () => {
      enableGsc();
      build((k) => (k.startsWith(SEO_GSC_INSPECT_BUDGET_PREFIX) ? '37' : null));

      const q = await service.getQuota();
      expect(q.gsc.state).toBe('ok');
      expect(q.gsc.inspectUsed).toBe(37);
      expect(q.gsc.inspectCap).toBe(2000);
      expect(q.gsc.source).toBe('estimated');
      // The counter key is the America/Los_Angeles date (YYYYMMDD), 8 digits.
      const counterCall = redis.get.mock.calls.find((c) =>
        String(c[0]).startsWith(SEO_GSC_INSPECT_BUDGET_PREFIX),
      );
      expect(counterCall?.[0]).toMatch(new RegExp(`^${SEO_GSC_INSPECT_BUDGET_PREFIX}\\d{8}$`));
    });

    it('reports GSC inspect budget disabled (used 0) when GSC is off', async () => {
      const q = await service.getQuota();
      expect(q.gsc.state).toBe('disabled');
      expect(q.gsc.inspectUsed).toBe(0);
      expect(q.gsc.inspectCap).toBe(2000);
    });

    it('always advertises the IndexNow dedup window (300s)', async () => {
      const q = await service.getQuota();
      expect(q.indexnow).toEqual({ dedupWindowSeconds: 300 });
    });
  });

  // ── getSearchAnalytics() ──────────────────────────────────────────────────────

  describe('getSearchAnalytics()', () => {
    /** Resolve each of the four fan-out queries by its requested dimension. */
    const wireAnalytics = () =>
      mockSearchAnalyticsQuery.mockImplementation(
        (params: { requestBody: { dimensions?: string[] } }) => {
          const dims = params.requestBody.dimensions;
          if (!dims) {
            return Promise.resolve({
              data: { rows: [{ clicks: 100, impressions: 2000, ctr: 0.05, position: 7.5 }] },
            });
          }
          if (dims[0] === 'date') {
            return Promise.resolve({
              data: {
                rows: [
                  { keys: ['2026-06-01'], clicks: 10, impressions: 200, ctr: 0.05, position: 7 },
                ],
                metadata: { firstIncompleteDate: '2026-06-26' },
              },
            });
          }
          if (dims[0] === 'query') {
            return Promise.resolve({
              data: {
                rows: [{ keys: ['honey'], clicks: 40, impressions: 800, ctr: 0.05, position: 4 }],
              },
            });
          }
          // dims[0] === 'page'
          return Promise.resolve({
            data: {
              rows: [
                {
                  keys: ['https://atlas.example/en/catalog/product/honey'],
                  clicks: 25,
                  impressions: 500,
                  ctr: 0.05,
                  position: 3,
                },
              ],
            },
          });
        },
      );

    it('reports state:disabled without calling searchanalytics.query when GSC is off', async () => {
      const a = await service.getSearchAnalytics();
      expect(a.state).toBe('disabled');
      expect(a.totals).toBeNull();
      expect(a.series).toEqual([]);
      expect(a.asOf).toBeNull();
      expect(mockSearchAnalyticsQuery).not.toHaveBeenCalled();
    });

    it('maps totals, the daily series, asOf and the top-10s for the default 28d range, and caches it', async () => {
      enableGsc();
      build();
      wireAnalytics();

      const a = await service.getSearchAnalytics();

      expect(a.state).toBe('ok');
      expect(a.range).toBe('28d');
      expect(a.totals).toEqual({ clicks: 100, impressions: 2000, ctr: 0.05, position: 7.5 });
      expect(a.series).toEqual([
        { date: '2026-06-01', clicks: 10, impressions: 200, ctr: 0.05, position: 7 },
      ]);
      expect(a.asOf).toBe('2026-06-26');
      expect(a.topQueries[0]).toMatchObject({ query: 'honey', clicks: 40 });
      expect(a.topPages[0].page).toContain('/catalog/product/honey');
      // Write-through cached under the range-keyed analytics key.
      expect(redis.setex).toHaveBeenCalledWith(
        `${SEO_ANALYTICS_CACHE_PREFIX}28d`,
        expect.any(Number),
        expect.any(String),
      );
    });

    it.each([
      ['7d', 7],
      ['28d', 28],
      ['90d', 90],
    ] as const)(
      'passes a %s PT date window and keys the cache by range',
      async (range, expectedDays) => {
        enableGsc();
        build();
        mockSearchAnalyticsQuery.mockResolvedValue({ data: { rows: [] } });

        await service.getSearchAnalytics(range);

        const first = mockSearchAnalyticsQuery.mock.calls[0][0] as {
          requestBody: { startDate: string; endDate: string };
        };
        expect(first.requestBody.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(first.requestBody.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // GSC bounds are inclusive, so the window covers (diff + 1) calendar days.
        const inclusiveDays =
          Math.round(
            (Date.parse(first.requestBody.endDate) - Date.parse(first.requestBody.startDate)) /
              86_400_000,
          ) + 1;
        expect(inclusiveDays).toBe(expectedDays);
        // Range echoed into the cache key so 7d/28d/90d never collide.
        expect(redis.setex).toHaveBeenCalledWith(
          `${SEO_ANALYTICS_CACHE_PREFIX}${range}`,
          expect.any(Number),
          expect.any(String),
        );
      },
    );

    it('reports state:error without caching when a query rejects', async () => {
      enableGsc();
      build();
      mockSearchAnalyticsQuery.mockRejectedValue(new Error('insufficient permission'));

      const a = await service.getSearchAnalytics('90d');

      expect(a.state).toBe('error');
      expect(a.detail).toContain('insufficient permission');
      expect(a.range).toBe('90d');
      expect(a.totals).toBeNull();
      // A transient probe failure must not be frozen into the 6 h cache.
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('returns the cached snapshot without calling googleapis on a cache hit', async () => {
      const snapshot = {
        state: 'ok',
        detail: '28 day(s)',
        range: '28d',
        asOf: '2026-06-26',
        totals: { clicks: 5, impressions: 9, ctr: 0.5, position: 1 },
        series: [],
        topQueries: [],
        topPages: [],
      };
      enableGsc();
      build((k) => (k === `${SEO_ANALYTICS_CACHE_PREFIX}28d` ? JSON.stringify(snapshot) : null));

      const a = await service.getSearchAnalytics('28d');
      expect(a).toEqual(snapshot);
      expect(mockSearchAnalyticsQuery).not.toHaveBeenCalled();
    });
  });

  // ── recheckHealth() ───────────────────────────────────────────────────────────

  describe('recheckHealth()', () => {
    it('runs a live probe, persists the snapshot, and returns it', async () => {
      process.env.STOREFRONT_PUBLIC_BASE_URL = 'https://atlas.example';
      build();
      const health: SubmissionHealth = {
        checkedAt: '2026-06-28T09:00:00.000Z',
        healthy: true,
        gsc: { state: 'disabled', detail: 'off' },
        bing: { state: 'disabled', detail: 'off' },
        publicSitemap: { state: 'ok', detail: 'HTTP 200' },
      };
      submit.checkSubmissionHealth.mockResolvedValue(health);

      const out = await service.recheckHealth();
      expect(submit.checkSubmissionHealth).toHaveBeenCalledWith('https://atlas.example');
      expect(seo.setSubmissionHealth).toHaveBeenCalledWith(health);
      expect(out).toEqual(health);
    });

    it('returns the fresh probe result even when persisting the snapshot fails', async () => {
      process.env.STOREFRONT_PUBLIC_BASE_URL = 'https://atlas.example';
      build();
      const health: SubmissionHealth = {
        checkedAt: '2026-06-28T09:00:00.000Z',
        healthy: true,
        gsc: { state: 'disabled', detail: 'off' },
        bing: { state: 'disabled', detail: 'off' },
        publicSitemap: { state: 'ok', detail: 'HTTP 200' },
      };
      submit.checkSubmissionHealth.mockResolvedValue(health);
      seo.setSubmissionHealth.mockRejectedValue(new Error('redis down'));

      const out = await service.recheckHealth();
      expect(out).toEqual(health);
    });
  });
});
