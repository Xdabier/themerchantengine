import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CmsService } from '@storefront-services';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CmsNavService } from './cms-nav.service';
import type { CmsPage } from '@storefront-types';

function page(overrides: Partial<CmsPage> & Pick<CmsPage, 'slug'>): CmsPage {
  return {
    id: `cms-${overrides.slug}`,
    type: 'STATIC',
    title: overrides.slug,
    content: 'Body',
    isPublished: true,
    showInNavigation: true,
    sortOrder: 0,
    ...overrides,
  } as CmsPage;
}

function setup(rows: CmsPage[] | Error, platform: string = 'browser') {
  const listPages = vi.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: CmsService, useValue: { listPages } },
    ],
  });
  return { service: TestBed.inject(CmsNavService), listPages };
}

describe('CmsNavService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('starts empty so the SSR footer renders exactly its built-in links', () => {
    const { service, listPages } = setup([page({ slug: '/faq' })], 'server');
    expect(service.pages()).toEqual([]);
    expect(listPages).not.toHaveBeenCalled();
  });

  it('never fetches on the server', async () => {
    const { service, listPages } = setup([page({ slug: '/faq' })], 'server');
    await service.load();
    expect(listPages).not.toHaveBeenCalled();
    expect(service.pages()).toEqual([]);
  });

  it('exposes the published pages flagged for navigation', async () => {
    const { service } = setup([
      page({ slug: '/faq', sortOrder: 2 }),
      page({ slug: '/contact', sortOrder: 1 }),
    ]);
    await service.load();
    expect(service.pages().map((p) => p.slug)).toEqual(['/contact', '/faq']);
  });

  it('drops rows the operator excluded from navigation', async () => {
    const { service } = setup([
      page({ slug: '/faq' }),
      page({ slug: '/internal', showInNavigation: false }),
    ]);
    await service.load();
    expect(service.pages().map((p) => p.slug)).toEqual(['/faq']);
  });

  it('drops unpublished rows even if the API ever sends one', async () => {
    const { service } = setup([
      page({ slug: '/faq' }),
      page({ slug: '/draft', isPublished: false }),
    ]);
    await service.load();
    expect(service.pages().map((p) => p.slug)).toEqual(['/faq']);
  });

  it('drops the five slugs that already own a dedicated route', async () => {
    const { service } = setup([
      page({ slug: '/about' }),
      page({ slug: '/privacy-policy' }),
      page({ slug: '/return-policy' }),
      page({ slug: '/terms' }),
      page({ slug: '/shipping-info' }),
      page({ slug: '/faq' }),
    ]);
    await service.load();
    expect(service.pages().map((p) => p.slug)).toEqual(['/faq']);
  });

  it('drops multi-segment slugs the generic route cannot serve', async () => {
    const { service } = setup([page({ slug: '/landing/summer' }), page({ slug: '/faq' })]);
    await service.load();
    expect(service.pages().map((p) => p.slug)).toEqual(['/faq']);
  });

  it('sorts by sortOrder, and by slug when the order ties', async () => {
    const { service } = setup([
      page({ slug: '/zeta', sortOrder: 1 }),
      page({ slug: '/alpha', sortOrder: 1 }),
      page({ slug: '/first', sortOrder: 0 }),
    ]);
    await service.load();
    expect(service.pages().map((p) => p.slug)).toEqual(['/first', '/alpha', '/zeta']);
  });

  it('resolves to an empty list on a fetch failure and never throws', async () => {
    const { service } = setup(new Error('network down'));
    await expect(service.load()).resolves.toBeUndefined();
    expect(service.pages()).toEqual([]);
  });

  it('fetches once and reuses the result', async () => {
    const { service, listPages } = setup([page({ slug: '/faq' })]);
    await Promise.all([service.load(), service.load()]);
    await service.load();
    expect(listPages).toHaveBeenCalledTimes(1);
  });
});
