import type Redis from 'ioredis';
import { SearchEngineSubmitService } from './search-engine-submit.service';

// Mock googleapis at module scope so the import in the SUT picks up the mock.
const mockSitemapsSubmit = jest.fn();
const mockSitemapsList = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: jest.fn().mockImplementation(() => ({})),
    },
    searchconsole: jest.fn().mockImplementation(() => ({
      sitemaps: {
        submit: (...args: unknown[]) => mockSitemapsSubmit(...args),
        list: (...args: unknown[]) => mockSitemapsList(...args),
      },
    })),
  },
}));

describe('SearchEngineSubmitService', () => {
  let service: SearchEngineSubmitService;
  let originalFetch: typeof fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    service = new SearchEngineSubmitService();
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    mockSitemapsSubmit.mockReset();
    mockSitemapsList.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  // ── submitToIndexNow ──────────────────────────────────────────────────────

  describe('submitToIndexNow()', () => {
    it('POSTs the IndexNow body shape and returns accepted=true on 200', async () => {
      process.env.INDEXNOW_KEY = 'deadbeef'.repeat(8);
      const fetchMock = jest
        .fn()
        .mockResolvedValue({ status: 200, text: () => Promise.resolve('') });
      global.fetch = fetchMock as unknown as typeof fetch;

      const urls = ['https://atlas.example/fr/catalog/product/widget'];
      const result = await service.submitToIndexNow(urls, 'https://atlas.example');

      expect(result).toEqual({ accepted: true, submitted: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [endpoint, init] = fetchMock.mock.calls[0];
      expect(endpoint).toBe('https://api.indexnow.org/indexnow');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.host).toBe('atlas.example');
      expect(body.key).toBe('deadbeef'.repeat(8));
      expect(body.keyLocation).toBe(`https://atlas.example/${'deadbeef'.repeat(8)}.txt`);
      expect(body.urlList).toEqual(urls);
    });

    it('chunks URL lists exceeding 10 000 entries into batches', async () => {
      process.env.INDEXNOW_KEY = 'a'.repeat(32);
      const fetchMock = jest
        .fn()
        .mockResolvedValue({ status: 200, text: () => Promise.resolve('') });
      global.fetch = fetchMock as unknown as typeof fetch;

      const urls = Array.from({ length: 25_000 }, (_, i) => `https://atlas.example/p/${i}`);
      const result = await service.submitToIndexNow(urls, 'https://atlas.example');

      expect(result).toEqual({ accepted: true, submitted: 25_000 });
      expect(fetchMock).toHaveBeenCalledTimes(3); // 10000 + 10000 + 5000
      const lastBody = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(lastBody.urlList).toHaveLength(5_000);
    });

    it('fail-opens with reason when INDEXNOW_KEY is unset', async () => {
      delete process.env.INDEXNOW_KEY;
      const result = await service.submitToIndexNow(
        ['https://atlas.example/p/1'],
        'https://atlas.example',
      );

      expect(result).toEqual({
        accepted: false,
        submitted: 0,
        reason: 'INDEXNOW_KEY unset',
      });
    });

    it('fail-opens with reason on a 5xx response', async () => {
      process.env.INDEXNOW_KEY = 'a'.repeat(32);
      global.fetch = jest.fn().mockResolvedValue({
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      }) as unknown as typeof fetch;

      const result = await service.submitToIndexNow(
        ['https://atlas.example/p/1'],
        'https://atlas.example',
      );

      expect(result.accepted).toBe(false);
      expect(result.submitted).toBe(0);
      expect(result.reason).toContain('503');
    });

    it('fail-opens with reason on a network error', async () => {
      process.env.INDEXNOW_KEY = 'a'.repeat(32);
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

      const result = await service.submitToIndexNow(
        ['https://atlas.example/p/1'],
        'https://atlas.example',
      );

      expect(result.accepted).toBe(false);
      expect(result.submitted).toBe(0);
      expect(result.reason).toContain('ECONNREFUSED');
    });

    it('returns submitted=0 on an empty URL list without calling fetch', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const result = await service.submitToIndexNow([], 'https://atlas.example');
      expect(result).toEqual({ accepted: true, submitted: 0 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('honors INDEXNOW_HOST override when set (staging/cert-host divergence)', async () => {
      process.env.INDEXNOW_KEY = 'a'.repeat(32);
      process.env.INDEXNOW_HOST = 'staging.atlas.example';
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(''),
      }) as unknown as typeof fetch;

      await service.submitToIndexNow(['https://atlas.example/p/1'], 'https://atlas.example');

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.host).toBe('staging.atlas.example');
    });
  });

  // ── submitToIndexNow() per-URL dedup (DR-15) ──────────────────────────────

  describe('submitToIndexNow() dedup window', () => {
    it('skips URLs already claimed in the dedup window (Redis SET NX) and POSTs only fresh ones', async () => {
      process.env.INDEXNOW_KEY = 'a'.repeat(32);
      const fetchMock = jest
        .fn()
        .mockResolvedValue({ status: 200, text: () => Promise.resolve('') });
      global.fetch = fetchMock as unknown as typeof fetch;
      const redis = {
        set: jest
          .fn()
          .mockResolvedValueOnce('OK') // first URL: freshly claimed
          .mockResolvedValueOnce(null), // second URL: already claimed within window
      };
      const svc = new SearchEngineSubmitService(redis as unknown as Redis);

      const result = await svc.submitToIndexNow(
        ['https://atlas.example/a', 'https://atlas.example/b'],
        'https://atlas.example',
      );

      expect(result).toEqual({ accepted: true, submitted: 1 });
      expect(redis.set).toHaveBeenCalledTimes(2);
      expect(redis.set.mock.calls[0]).toEqual([
        'seo:indexnow:dedup:https://atlas.example/a',
        '1',
        'EX',
        300,
        'NX',
      ]);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.urlList).toEqual(['https://atlas.example/a']);
    });

    it('returns submitted=0 and does not POST when every URL is deduped', async () => {
      process.env.INDEXNOW_KEY = 'a'.repeat(32);
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const redis = { set: jest.fn().mockResolvedValue(null) };
      const svc = new SearchEngineSubmitService(redis as unknown as Redis);

      const result = await svc.submitToIndexNow(
        ['https://atlas.example/a'],
        'https://atlas.example',
      );

      expect(result.accepted).toBe(true);
      expect(result.submitted).toBe(0);
      expect(result.reason).toContain('deduped');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fail-opens (submits anyway) when Redis throws during dedup', async () => {
      process.env.INDEXNOW_KEY = 'a'.repeat(32);
      const fetchMock = jest
        .fn()
        .mockResolvedValue({ status: 200, text: () => Promise.resolve('') });
      global.fetch = fetchMock as unknown as typeof fetch;
      const redis = { set: jest.fn().mockRejectedValue(new Error('redis down')) };
      const svc = new SearchEngineSubmitService(redis as unknown as Redis);

      const result = await svc.submitToIndexNow(
        ['https://atlas.example/a'],
        'https://atlas.example',
      );

      expect(result).toEqual({ accepted: true, submitted: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── submitToGsc ───────────────────────────────────────────────────────────

  describe('submitToGsc()', () => {
    it('returns disabled no-op when GSC_SUBMISSION_ENABLED is unset', async () => {
      delete process.env.GSC_SUBMISSION_ENABLED;
      const result = await service.submitToGsc('/sitemap_index.xml');
      expect(result).toEqual({
        accepted: false,
        submitted: 0,
        reason: 'disabled',
      });
      expect(mockSitemapsSubmit).not.toHaveBeenCalled();
    });

    it('returns disabled no-op when GSC_SUBMISSION_ENABLED is "false"', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'false';
      const result = await service.submitToGsc('/sitemap_index.xml');
      expect(result).toEqual({
        accepted: false,
        submitted: 0,
        reason: 'disabled',
      });
      expect(mockSitemapsSubmit).not.toHaveBeenCalled();
    });

    it('calls sitemaps.submit with siteUrl + feedpath shape on happy path', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'true';
      process.env.GSC_SITE_URL = 'sc-domain:atlas.example';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/etc/gsc/sa.json';
      mockSitemapsSubmit.mockResolvedValue({});

      const result = await service.submitToGsc('https://atlas.example/sitemap_index.xml');

      expect(result).toEqual({ accepted: true, submitted: 1 });
      expect(mockSitemapsSubmit).toHaveBeenCalledWith({
        siteUrl: 'sc-domain:atlas.example',
        feedpath: 'https://atlas.example/sitemap_index.xml',
      });
    });

    it('fail-opens with reason when GSC_SITE_URL is unset', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'true';
      delete process.env.GSC_SITE_URL;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/etc/gsc/sa.json';

      const result = await service.submitToGsc('/sitemap_index.xml');
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('GSC_SITE_URL unset');
    });

    it('fail-opens with reason when GOOGLE_APPLICATION_CREDENTIALS is unset', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'true';
      process.env.GSC_SITE_URL = 'sc-domain:atlas.example';
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const result = await service.submitToGsc('/sitemap_index.xml');
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('GOOGLE_APPLICATION_CREDENTIALS unset');
    });

    it('fail-opens with reason on auth / quota error from sitemaps.submit', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'true';
      process.env.GSC_SITE_URL = 'sc-domain:atlas.example';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/etc/gsc/sa.json';
      mockSitemapsSubmit.mockRejectedValue(new Error('Quota exceeded'));

      const result = await service.submitToGsc('https://atlas.example/sitemap_index.xml');
      expect(result.accepted).toBe(false);
      expect(result.submitted).toBe(0);
      expect(result.reason).toContain('Quota exceeded');
    });
  });

  // ── submitToBing() (DR-16) ─────────────────────────────────────────────────

  describe('submitToBing()', () => {
    it('returns disabled no-op when BING_API_KEY is unset', async () => {
      delete process.env.BING_API_KEY;
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const result = await service.submitToBing('https://atlas.example/sitemap_index.xml');
      expect(result).toEqual({ accepted: false, submitted: 0, reason: 'disabled' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('POSTs the SubmitFeed shape and returns accepted on 200', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      const fetchMock = jest
        .fn()
        .mockResolvedValue({ status: 200, text: () => Promise.resolve('') });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await service.submitToBing('https://atlas.example/sitemap_index.xml');

      expect(result).toEqual({ accepted: true, submitted: 1 });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://ssl.bing.com/webmaster/api.svc/json/SubmitFeed?apikey=bkey');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        siteUrl: 'https://atlas.example',
        feedUrl: 'https://atlas.example/sitemap_index.xml',
      });
    });

    it('fail-opens with reason on a non-200 response', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      global.fetch = jest.fn().mockResolvedValue({
        status: 401,
        text: () => Promise.resolve('invalid key'),
      }) as unknown as typeof fetch;

      const result = await service.submitToBing('https://atlas.example/sitemap_index.xml');
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('401');
    });

    it('fail-opens with reason on a network error', async () => {
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

      const result = await service.submitToBing('https://atlas.example/sitemap_index.xml');
      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('ECONNRESET');
    });
  });

  // ── checkSubmissionHealth() (DR-16) ────────────────────────────────────────

  describe('checkSubmissionHealth()', () => {
    it('reports disabled GSC + Bing and a healthy public sitemap as overall healthy', async () => {
      delete process.env.GSC_SUBMISSION_ENABLED;
      delete process.env.BING_API_KEY;
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('<?xml?><sitemapindex></sitemapindex>'),
      }) as unknown as typeof fetch;

      const h = await service.checkSubmissionHealth('https://atlas.example');

      expect(h.gsc.state).toBe('disabled');
      expect(h.bing.state).toBe('disabled');
      expect(h.publicSitemap.state).toBe('ok');
      expect(h.healthy).toBe(true);
    });

    it('reports GSC ok when the index is registered, error-free and freshly downloaded', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'true';
      process.env.GSC_SITE_URL = 'sc-domain:atlas.example';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/etc/gsc/sa.json';
      delete process.env.BING_API_KEY;
      mockSitemapsList.mockResolvedValue({
        data: {
          sitemap: [
            {
              path: 'https://atlas.example/sitemap_index.xml',
              errors: '0',
              lastDownloaded: new Date().toISOString(),
            },
          ],
        },
      });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('<sitemapindex></sitemapindex>'),
      }) as unknown as typeof fetch;

      const h = await service.checkSubmissionHealth('https://atlas.example');
      expect(h.gsc.state).toBe('ok');
      expect(h.healthy).toBe(true);
    });

    it('reports GSC error (and overall unhealthy) when the index has errors', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'true';
      process.env.GSC_SITE_URL = 'sc-domain:atlas.example';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/etc/gsc/sa.json';
      delete process.env.BING_API_KEY;
      mockSitemapsList.mockResolvedValue({
        data: {
          sitemap: [
            {
              path: 'https://atlas.example/sitemap_index.xml',
              errors: '3',
              lastDownloaded: new Date().toISOString(),
            },
          ],
        },
      });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('<sitemapindex></sitemapindex>'),
      }) as unknown as typeof fetch;

      const h = await service.checkSubmissionHealth('https://atlas.example');
      expect(h.gsc.state).toBe('error');
      expect(h.healthy).toBe(false);
    });

    it('reports GSC missing when the index is not registered in the property', async () => {
      process.env.GSC_SUBMISSION_ENABLED = 'true';
      process.env.GSC_SITE_URL = 'sc-domain:atlas.example';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/etc/gsc/sa.json';
      delete process.env.BING_API_KEY;
      mockSitemapsList.mockResolvedValue({ data: { sitemap: [] } });
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve('<sitemapindex></sitemapindex>'),
      }) as unknown as typeof fetch;

      const h = await service.checkSubmissionHealth('https://atlas.example');
      expect(h.gsc.state).toBe('missing');
      expect(h.healthy).toBe(false);
    });

    it('reports Bing ok when GetFeeds returns the sitemap feed', async () => {
      delete process.env.GSC_SUBMISSION_ENABLED;
      process.env.BING_API_KEY = 'bkey';
      process.env.BING_SITE_URL = 'https://atlas.example';
      global.fetch = jest.fn().mockImplementation((u: unknown) => {
        if (String(u).includes('GetFeeds')) {
          return Promise.resolve({
            status: 200,
            json: () =>
              Promise.resolve({ d: [{ Url: 'https://atlas.example/sitemap_index.xml' }] }),
          });
        }
        return Promise.resolve({
          status: 200,
          text: () => Promise.resolve('<sitemapindex></sitemapindex>'),
        });
      }) as unknown as typeof fetch;

      const h = await service.checkSubmissionHealth('https://atlas.example');
      expect(h.bing.state).toBe('ok');
      expect(h.healthy).toBe(true);
    });

    it('reports publicSitemap error (and overall unhealthy) when the index does not serve', async () => {
      delete process.env.GSC_SUBMISSION_ENABLED;
      delete process.env.BING_API_KEY;
      global.fetch = jest.fn().mockResolvedValue({
        status: 502,
        text: () => Promise.resolve('bad gateway'),
      }) as unknown as typeof fetch;

      const h = await service.checkSubmissionHealth('https://atlas.example');
      expect(h.publicSitemap.state).toBe('error');
      expect(h.healthy).toBe(false);
    });
  });

  // ── previewIndexNowDedup (DR-17 D2 dryRun, non-claiming) ───────────────────

  describe('previewIndexNowDedup()', () => {
    const urls = ['https://x/a', 'https://x/b', 'https://x/c'];

    it('returns all fresh when no Redis client is wired (unit context)', async () => {
      const noRedis = new SearchEngineSubmitService();
      expect(await noRedis.previewIndexNowDedup(urls)).toEqual({ fresh: 3, deduped: 0 });
    });

    it('returns zero for an empty URL list without touching Redis', async () => {
      const exists = jest.fn();
      const svc = new SearchEngineSubmitService({ exists } as unknown as Redis);
      expect(await svc.previewIndexNowDedup([])).toEqual({ fresh: 0, deduped: 0 });
      expect(exists).not.toHaveBeenCalled();
    });

    it('counts URLs already inside the dedup window (EXISTS=1) WITHOUT claiming', async () => {
      // First URL is in-window, the other two are fresh.
      const exists = jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      const svc = new SearchEngineSubmitService({ exists } as unknown as Redis);
      expect(await svc.previewIndexNowDedup(urls)).toEqual({ fresh: 2, deduped: 1 });
      // Non-claiming: only EXISTS is used, never SET.
      expect(exists).toHaveBeenCalledTimes(3);
    });

    it('fails open — a Redis error counts the URL as fresh', async () => {
      const exists = jest.fn().mockRejectedValue(new Error('redis down'));
      const svc = new SearchEngineSubmitService({ exists } as unknown as Redis);
      expect(await svc.previewIndexNowDedup(urls)).toEqual({ fresh: 3, deduped: 0 });
    });
  });
});
