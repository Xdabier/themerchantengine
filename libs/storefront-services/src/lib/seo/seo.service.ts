import { Inject, Injectable } from '@angular/core';
import type { ApiClient } from '../shared/api-client.token';
import { STOREFRONT_API_CLIENT } from '../shared/api-client.token';

/**
 * Storefront SEO surfaces are served as raw `application/xml` /
 * `text/plain` payloads and bypass the `{ data }` envelope. The storefront's
 * proxy server routes (S13) call this service to fetch the body and forward
 * the content-type through. Because the API responses are unwrapped, every
 * method returns the raw `string` payload — callers are responsible for
 * setting the response content-type when they pipe the body downstream.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  async sitemapIndex(): Promise<string> {
    return this.api.request<string>('GET', '/v1/sitemap_index.xml');
  }

  async sitemapProducts(): Promise<string> {
    return this.api.request<string>('GET', '/v1/sitemap-products.xml');
  }

  async sitemapCategories(): Promise<string> {
    return this.api.request<string>('GET', '/v1/sitemap-categories.xml');
  }

  async robotsTxt(): Promise<string> {
    return this.api.request<string>('GET', '/v1/robots.txt');
  }

  async llmsTxt(): Promise<string> {
    return this.api.request<string>('GET', '/v1/llms.txt');
  }
}
