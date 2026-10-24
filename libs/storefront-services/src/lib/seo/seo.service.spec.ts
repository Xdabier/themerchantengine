import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { SeoService } from './seo.service';

function mockClient(): { client: ApiClient; request: ApiClient['request'] } {
  const request = vi.fn(
    async () => '<?xml version="1.0"?><urlset></urlset>',
  ) as ApiClient['request'];
  const client = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request,
  } as unknown as ApiClient;
  return { client, request };
}

describe('SeoService', () => {
  it('sitemapIndex GETs /v1/sitemap_index.xml', async () => {
    const { client, request } = mockClient();
    await new SeoService(client).sitemapIndex();
    expect(request).toHaveBeenCalledWith('GET', '/v1/sitemap_index.xml');
  });

  it('sitemapProducts GETs the products sitemap', async () => {
    const { client, request } = mockClient();
    await new SeoService(client).sitemapProducts();
    expect(request).toHaveBeenCalledWith('GET', '/v1/sitemap-products.xml');
  });

  it('sitemapCategories GETs the categories sitemap', async () => {
    const { client, request } = mockClient();
    await new SeoService(client).sitemapCategories();
    expect(request).toHaveBeenCalledWith('GET', '/v1/sitemap-categories.xml');
  });

  it('robotsTxt GETs /v1/robots.txt', async () => {
    const { client, request } = mockClient();
    await new SeoService(client).robotsTxt();
    expect(request).toHaveBeenCalledWith('GET', '/v1/robots.txt');
  });

  it('llmsTxt GETs /v1/llms.txt', async () => {
    const { client, request } = mockClient();
    await new SeoService(client).llmsTxt();
    expect(request).toHaveBeenCalledWith('GET', '/v1/llms.txt');
  });
});
