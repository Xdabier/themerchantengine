import type { Category } from '@admin-services';
import {
  categoryLabel,
  flattenForParentPicker,
  projectTree,
  type CategoryNodeView,
} from './categories.utils';

const node = (id: string, overrides: Partial<Category> = {}): Category =>
  ({
    id,
    name: { default: id, en: id },
    slug: id,
    parentId: null,
    imageId: null,
    sortOrder: 0,
    isVisible: true,
    productCount: 0,
    children: [],
    ...overrides,
  }) as Category;

describe('categories.utils', () => {
  describe('categoryLabel', () => {
    it('resolves in the operator locale', () => {
      const name = { fr: 'Bonjour', en: 'Hello', default: 'Hello' };
      expect(categoryLabel({ id: 'c1', slug: 's1', name }, 'fr', 'xx')).toBe('Bonjour');
      expect(categoryLabel({ id: 'c1', slug: 's1', name }, 'en', 'xx')).toBe('Hello');
    });
    it('falls back to en, then default, then any populated locale, then slug', () => {
      expect(categoryLabel({ id: 'c1', slug: 's1', name: { en: 'Hello' } }, 'fr', 'xx')).toBe(
        'Hello',
      );
      expect(categoryLabel({ id: 'c1', slug: 's1', name: { default: 'D' } }, 'fr', 'xx')).toBe('D');
      expect(categoryLabel({ id: 'c1', slug: 's1', name: { de: 'Hallo' } }, 'fr', 'xx')).toBe(
        'Hallo',
      );
      expect(categoryLabel({ id: 'c1', slug: 's1', name: {} }, 'fr', 'xx')).toBe('s1');
    });
    it('accepts plain strings for legacy data', () => {
      expect(categoryLabel({ id: 'c1', slug: 's1', name: 'Plain' as never }, 'fr', 'xx')).toBe(
        'Plain',
      );
    });
  });

  describe('projectTree', () => {
    it('assigns per-node depth', () => {
      const tree: Category[] = [node('a', { children: [node('a1', { children: [node('a11')] })] })];
      const projected = projectTree(tree, 'fr', 'xx');
      expect(projected[0].depth).toBe(0);
      expect(projected[0].children[0].depth).toBe(1);
      expect(projected[0].children[0].children[0].depth).toBe(2);
    });

    it('carries label + slug + productCount through projection', () => {
      const tree: Category[] = [node('a', { productCount: 5, slug: 'alpha' })];
      const [view] = projectTree(tree, 'fr', 'xx') as [CategoryNodeView];
      expect(view.slug).toBe('alpha');
      expect(view.productCount).toBe(5);
    });
  });

  describe('flattenForParentPicker', () => {
    const fixture: Category[] = [
      node('a', {
        children: [node('a1'), node('a2', { children: [node('a21')] })],
      }),
      node('b'),
    ];

    it('returns a depth-tagged flat list', () => {
      const list = flattenForParentPicker(fixture, null, 'fr', 'xx');
      expect(list.map((i) => i.id)).toEqual(['a', 'a1', 'a2', 'a21', 'b']);
      expect(list.map((i) => i.depth)).toEqual([0, 1, 1, 2, 0]);
    });

    it('excludes the given id + its subtree', () => {
      const list = flattenForParentPicker(fixture, 'a2', 'fr', 'xx');
      expect(list.map((i) => i.id)).toEqual(['a', 'a1', 'b']);
    });

    it('excludes nothing when id is not in the tree', () => {
      expect(flattenForParentPicker(fixture, 'zzz', 'fr', 'xx').length).toBe(5);
    });
  });
});
