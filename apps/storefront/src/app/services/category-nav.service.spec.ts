import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CategoriesService, type RequestOptions } from '@storefront-services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '../../i18n/types';
import { LocaleService } from '../locale.service';
import { CategoryNavService } from './category-nav.service';
import type { Category } from '@storefront-types';

function category(
  slug: string,
  overrides: Partial<Category> & { children?: Category[] } = {},
): Category {
  return {
    id: `cat-${slug}`,
    slug,
    name: { fr: `${slug} fr`, en: `${slug} en` },
    parentId: null,
    isVisible: true,
    ...overrides,
  } as unknown as Category;
}

function setup(rows: Category[] | Error, platform: string = 'browser') {
  const list = vi.fn<(options?: RequestOptions) => Promise<Category[]>>(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  const locale = signal<Locale>('en');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: CategoriesService, useValue: { list } },
      { provide: LocaleService, useValue: { locale } },
    ],
  });
  return { service: TestBed.inject(CategoryNavService), list, locale };
}

describe('CategoryNavService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('starts empty so the SSR chrome renders without waiting on a fetch', () => {
    const { service, list } = setup([category('implants')]);
    expect(service.categories()).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('never fetches on the server', async () => {
    const { service, list } = setup([category('implants')], 'server');
    await service.load();
    expect(list).not.toHaveBeenCalled();
    expect(service.categories()).toEqual([]);
  });

  /**
   * K5: the header nav and the catalog chip strip both read this store, so a
   * page mounting both must still pay for one request.
   */
  it('fetches once per session however many consumers ask', async () => {
    const { service, list } = setup([category('implants')]);
    await Promise.all([service.load(), service.load(), service.load()]);
    await service.load();
    expect(list).toHaveBeenCalledTimes(1);
    expect(service.categories().map((c) => c.slug)).toEqual(['implants']);
  });

  it('exposes only the top level for the nav row, children kept for the drawer', async () => {
    const child = category('titanium', { parentId: 'cat-implants' });
    const { service } = setup([
      category('implants', { children: [child] }),
      category('imaging'),
      child,
    ]);
    await service.load();
    expect(service.topLevel().map((c) => c.slug)).toEqual(['implants', 'imaging']);
    const children = service.topLevel()[0].children as Category[] | undefined;
    expect(children?.map((c) => c.slug)).toEqual(['titanium']);
  });

  /**
   * The nav fetch fires on hydration, before the effect that writes
   * `<html lang>`. Read from `<html lang>`, the request fell back to the
   * default locale and an `/en/` page showed French category names.
   */
  describe('locale', () => {
    let savedLang: string | null;
    beforeEach(() => {
      savedLang = document.documentElement.getAttribute('lang');
      document.documentElement.removeAttribute('lang');
    });
    afterEach(() => {
      if (savedLang === null) document.documentElement.removeAttribute('lang');
      else document.documentElement.setAttribute('lang', savedLang);
    });

    it('requests the page locale explicitly, not whatever <html lang> holds', async () => {
      const { service, list } = setup([category('implants')]);
      await service.load();
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ 'Accept-Language': 'en', 'X-Locale': 'en' }),
        }),
      );
    });

    it('refetches when the locale changes, once per locale', async () => {
      const { service, list, locale } = setup([category('implants')]);
      await service.load();
      locale.set('fr');
      await Promise.all([service.load(), service.load()]);
      expect(list).toHaveBeenCalledTimes(2);
      expect(list.mock.calls[1][0]?.headers?.['X-Locale']).toBe('fr');
    });
  });

  /**
   * The chrome is not the catalogue. A categories outage costs the store its
   * nav row, never a thrown boot error or a console entry that would fail
   * every console-baselined journey.
   */
  it('degrades to an empty list when the fetch fails, silently', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
    const { service } = setup(new Error('categories down'));
    await expect(service.load()).resolves.toBeUndefined();
    expect(service.categories()).toEqual([]);
    expect(service.topLevel()).toEqual([]);
    expect(errors).toEqual([]);
    spy.mockRestore();
  });
});
