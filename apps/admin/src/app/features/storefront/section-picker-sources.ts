import { catchError, forkJoin, map, of } from 'rxjs';
import { pickTranslation } from '@admin-types';
import type { Category, CategoriesService, Product, ProductsService } from '@admin-services';

import type { EntitySelectSource } from '../../shared/entity-select/entity-select.types';

/** Small pages: the operator searches for a row, never scrolls to it. */
export const SECTION_PICKER_PAGE_SIZE = 20;

/** Depth-first flatten, so a subcategory is as selectable as a root. */
function flatten(nodes: readonly Category[], out: Category[] = []): Category[] {
  for (const node of nodes) {
    out.push(node);
    const children = (node as { children?: Category[] }).children ?? [];
    flatten(children, out);
  }
  return out;
}

function categoryOption(cat: Category, locale: string, defaultLocale: string) {
  return {
    id: cat.id,
    label: pickTranslation(cat.name, locale, '', defaultLocale) || cat.slug,
    sublabel: cat.slug,
    value: cat,
  };
}

/**
 * Category lookup for the storefront section editors.
 *
 * The admin `CategoriesService` exposes only `tree()`, with no server-side
 * search or pagination, so filtering happens here over the flattened tree.
 * That is acceptable at this size (the tree is one request and tens of rows,
 * not the hundreds the order picker faced) and it keeps the picker's
 * `EntitySelectSource` contract intact, so the editors need no special case.
 *
 * `resolve` deliberately returns nothing for an id the tree no longer
 * contains. Echoing the id back as its own label would hide exactly the config
 * rot AD14 exists to surface.
 */
export function createCategorySource(
  categories: CategoriesService,
  locale: () => string,
  defaultLocale: () => string,
): EntitySelectSource<Category> {
  return {
    search: (term, page) =>
      categories.tree().pipe(
        map((tree) => {
          const needle = term.trim().toLowerCase();
          const all = flatten(tree).map((c) => categoryOption(c, locale(), defaultLocale()));
          const matches = needle
            ? all.filter(
                (o) =>
                  o.label.toLowerCase().includes(needle) ||
                  o.sublabel.toLowerCase().includes(needle),
              )
            : all;
          const start = (page - 1) * SECTION_PICKER_PAGE_SIZE;
          return {
            options: matches.slice(start, start + SECTION_PICKER_PAGE_SIZE),
            total: matches.length,
          };
        }),
      ),
    resolve: (ids) =>
      categories.tree().pipe(
        map((tree) => {
          const byId = new Map(flatten(tree).map((c) => [c.id, c]));
          return ids
            .map((id) => byId.get(id))
            .filter((c): c is Category => c !== undefined)
            .map((c) => categoryOption(c, locale(), defaultLocale()));
        }),
      ),
  };
}

function productOption(product: Product, locale: string, defaultLocale: string) {
  return {
    id: product.id,
    label: pickTranslation(product.name, locale, '', defaultLocale) || product.slug,
    sublabel: product.slug,
    value: product,
  };
}

/**
 * Product lookup for the FEATURED_PRODUCTS editor. Server-searched and
 * paginated, unlike categories, because the catalogue is large enough that a
 * single fetch would put most of it out of reach.
 */
export function createProductSource(
  products: ProductsService,
  locale: () => string,
  defaultLocale: () => string,
): EntitySelectSource<Product> {
  return {
    search: (term, page) =>
      products
        .listProducts({
          page,
          pageSize: SECTION_PICKER_PAGE_SIZE,
          ...(term.trim() ? { search: term.trim() } : {}),
        })
        .pipe(
          map((res) => ({
            options: res.data.map((p) => productOption(p, locale(), defaultLocale())),
            total: res.meta.total,
          })),
        ),
    /**
     * Same contract as the category source: an id the catalogue no longer
     * carries resolves to nothing, so the editor can flag it rather than
     * rendering a plausible-looking label for a dead reference.
     *
     * Resolved one id at a time because `listProductsQuery` has no `ids`
     * filter, and an unknown key is stripped by the Zod parse rather than
     * rejected, so passing one would silently return page 1 of the whole
     * catalogue. A 404 is the expected answer for a dead id, not an error.
     */
    resolve: (ids) =>
      ids.length === 0
        ? of([])
        : forkJoin(
            ids.map((id) =>
              products.getProduct(id).pipe(
                map((p) => [productOption(p, locale(), defaultLocale())]),
                catchError(() => of([])),
              ),
            ),
          ).pipe(map((groups) => groups.flat())),
  };
}
