import type { Category } from '@admin-services';
import { pickTranslation, type Translatable } from '@admin-types';

export interface CategoryNodeView {
  readonly id: string;
  readonly label: string;
  readonly slug: string;
  readonly depth: number;
  readonly productCount: number;
  readonly isVisible: boolean;
  readonly children: readonly CategoryNodeView[];
}

/** Extract a human-visible label from the category's Translatable name. */
export function categoryLabel(
  category: Pick<Category, 'name' | 'slug' | 'id'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    category.name as Translatable | string | null | undefined,
    locale,
    category.slug ?? category.id,
    defaultLocale,
  );
}

/** Recursive projection of the tree into display rows with stable depth. */
export function projectTree(
  nodes: readonly Category[],
  locale: string,
  defaultLocale: string,
  depth = 0,
): CategoryNodeView[] {
  return nodes.map((node) => ({
    id: node.id,
    label: categoryLabel(node, locale, defaultLocale),
    slug: node.slug,
    depth,
    productCount: node.productCount ?? 0,
    isVisible: node.isVisible ?? true,
    children: projectTree(node.children ?? [], locale, defaultLocale, depth + 1),
  }));
}

/** Flat list of every node (id, label, depth) — for multi-select pickers. */
export function flattenAllCategories(
  nodes: readonly Category[],
  locale: string,
  defaultLocale: string,
  depth = 0,
): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, label: categoryLabel(n, locale, defaultLocale), depth });
    if (n.children && n.children.length > 0) {
      out.push(...flattenAllCategories(n.children, locale, defaultLocale, depth + 1));
    }
  }
  return out;
}

/** Flat list of (id, label, depth) for `parent` pickers; excludes the given id. */
export function flattenForParentPicker(
  nodes: readonly Category[],
  excludeId: string | null,
  locale: string,
  defaultLocale: string,
): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (list: readonly Category[], depth: number): void => {
    for (const n of list) {
      if (n.id === excludeId) {
        // Skip the node and its subtree — can't parent to self or descendants.
        continue;
      }
      out.push({ id: n.id, label: categoryLabel(n, locale, defaultLocale), depth });
      if (n.children && n.children.length > 0) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}
