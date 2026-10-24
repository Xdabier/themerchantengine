import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../shared/api-client.token';
import { CmsService } from './cms.service';

function mockClient(get: ApiClient['get']): ApiClient {
  return {
    get,
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
  } as unknown as ApiClient;
}

describe('CmsService', () => {
  it('getPageBySlug returns the resolved page payload', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'cms-1',
        slug: '/about',
        type: 'STATIC',
        title: 'About Us',
        content: 'Body',
        metaTitle: null,
        metaDescription: null,
      },
    })) as ApiClient['get'];
    const svc = new CmsService(mockClient(get));
    const page = await svc.getPageBySlug('/about');
    expect(page.slug).toBe('/about');
    expect(page.title).toBe('About Us');
    expect(get).toHaveBeenCalledWith('/v1/pages/about');
  });

  it('getPageBySlug forwards multi-segment policy slugs verbatim', async () => {
    const get = vi.fn(async () => ({
      data: {
        id: 'cms-2',
        slug: '/privacy-policy',
        type: 'POLICY',
        title: 'Privacy',
        content: 'Body',
      },
    })) as ApiClient['get'];
    const svc = new CmsService(mockClient(get));
    await svc.getPageBySlug('/privacy-policy');
    expect(get).toHaveBeenCalledWith('/v1/pages/privacy-policy');
  });

  it('getPageBySlug rejects a slug missing the leading /', async () => {
    const svc = new CmsService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.getPageBySlug('about')).rejects.toThrow();
  });

  it('getPageBySlug rejects an empty slug', async () => {
    const svc = new CmsService(mockClient(vi.fn() as ApiClient['get']));
    await expect(svc.getPageBySlug('')).rejects.toThrow();
  });

  it('getPageBySlug throws when the API envelope shape is wrong', async () => {
    const get = vi.fn(async () => ({ data: { id: 'cms-3' } })) as ApiClient['get'];
    const svc = new CmsService(mockClient(get));
    await expect(svc.getPageBySlug('/about')).rejects.toThrow();
  });

  it('listPages returns every published page the API sends', async () => {
    const get = vi.fn(async () => ({
      data: [
        {
          id: 'cms-1',
          slug: '/about',
          type: 'STATIC',
          title: 'About Us',
          content: 'Body',
          sortOrder: 0,
          showInNavigation: true,
        },
        {
          id: 'cms-2',
          slug: '/faq',
          type: 'STATIC',
          title: 'FAQ',
          content: 'Body',
          sortOrder: 6,
          showInNavigation: true,
        },
      ],
    })) as ApiClient['get'];
    const svc = new CmsService(mockClient(get));
    const pages = await svc.listPages();
    expect(get).toHaveBeenCalledWith('/v1/pages');
    expect(pages.map((p) => p.slug)).toEqual(['/about', '/faq']);
  });

  it('listPages returns an empty array when no page is published', async () => {
    const get = vi.fn(async () => ({ data: [] })) as ApiClient['get'];
    const svc = new CmsService(mockClient(get));
    await expect(svc.listPages()).resolves.toEqual([]);
  });

  it('listPages throws when a row is malformed', async () => {
    const get = vi.fn(async () => ({ data: [{ id: 'cms-1' }] })) as ApiClient['get'];
    const svc = new CmsService(mockClient(get));
    await expect(svc.listPages()).rejects.toThrow();
  });

  it('listPages throws when the envelope is not an array', async () => {
    const get = vi.fn(async () => ({
      data: { id: 'cms-1', slug: '/faq', type: 'STATIC', title: 'FAQ', content: 'Body' },
    })) as ApiClient['get'];
    const svc = new CmsService(mockClient(get));
    await expect(svc.listPages()).rejects.toThrow();
  });
});
