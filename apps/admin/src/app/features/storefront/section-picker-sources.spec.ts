import { of } from 'rxjs';
import type { Category, CategoriesService } from '@admin-services';

import { createCategorySource, SECTION_PICKER_PAGE_SIZE } from './section-picker-sources';

function category(id: string, name: string, children: Category[] = []): Category {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    name: { default: name, en: name, fr: name },
    children,
  } as unknown as Category;
}

const TREE: Category[] = [
  category('cat-rot', 'Instruments rotatifs', [
    category('cat-turb', 'Turbines'),
    category('cat-ca', 'Contre-angles'),
  ]),
  category('cat-cons', 'Consommables'),
];

function serviceStub(tree: Category[] = TREE): CategoriesService {
  return { tree: () => of(tree) } as unknown as CategoriesService;
}

describe('createCategorySource', () => {
  const locale = () => 'fr';
  const defaultLocale = () => 'en';

  it('flattens the tree so a child category is selectable, not just a root', async () => {
    // The admin CategoriesService exposes only `tree()`, so a source that
    // returned the top level alone would put every subcategory out of reach,
    // which is the same defect the order picker was built to fix.
    const source = createCategorySource(serviceStub(), locale, defaultLocale);
    const page = await new Promise<{ options: { id: string }[]; total: number }>((resolve) =>
      source.search('', 1).subscribe(resolve),
    );

    expect(page.options.map((o) => o.id)).toEqual(['cat-rot', 'cat-turb', 'cat-ca', 'cat-cons']);
    expect(page.total).toBe(4);
  });

  it('filters on the resolved label, case-insensitively', async () => {
    const source = createCategorySource(serviceStub(), locale, defaultLocale);
    const page = await new Promise<{ options: { id: string }[]; total: number }>((resolve) =>
      source.search('CONTRE', 1).subscribe(resolve),
    );

    expect(page.options.map((o) => o.id)).toEqual(['cat-ca']);
    expect(page.total).toBe(1);
  });

  it('reports the true match count even when the page truncates it', async () => {
    // The picker always renders the count, so a truncated list is allowed and a
    // silent one is not.
    const many = Array.from({ length: SECTION_PICKER_PAGE_SIZE + 5 }, (_, i) =>
      category(`cat-${i}`, `Category ${i}`),
    );
    const source = createCategorySource(serviceStub(many), locale, defaultLocale);
    const page = await new Promise<{ options: unknown[]; total: number }>((resolve) =>
      source.search('', 1).subscribe(resolve),
    );

    expect(page.options).toHaveLength(SECTION_PICKER_PAGE_SIZE);
    expect(page.total).toBe(SECTION_PICKER_PAGE_SIZE + 5);
  });

  it('resolves already-selected ids back to labels for the edit flow', async () => {
    const source = createCategorySource(serviceStub(), locale, defaultLocale);
    const options = await new Promise<{ id: string; label: string }[]>((resolve) =>
      source.resolve!(['cat-ca']).subscribe(resolve),
    );

    expect(options).toEqual([expect.objectContaining({ id: 'cat-ca', label: 'Contre-angles' })]);
  });

  it('resolves an id that no longer exists to nothing, rather than inventing a label', async () => {
    // AD14: a dead id must stay visibly dead so the editor can flag it. A
    // source that echoed the id back as its own label would hide the rot.
    const source = createCategorySource(serviceStub(), locale, defaultLocale);
    const options = await new Promise<unknown[]>((resolve) =>
      source.resolve!(['cat-gone']).subscribe(resolve),
    );

    expect(options).toEqual([]);
  });
});
