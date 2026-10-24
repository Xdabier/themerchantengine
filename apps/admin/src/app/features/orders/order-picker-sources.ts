import { map } from 'rxjs';
import { pickTranslation } from '@admin-types';
import type { Product, ProductsService, UsersService } from '@admin-services';
import type { EntitySelectSource } from '../../shared/entity-select/entity-select.types';

/** Small pages: the operator searches for a product, never scrolls to it. */
export const ORDER_PICKER_PAGE_SIZE = 20;

function productOption(product: Product, locale: string, defaultLocale: string) {
  const skus = (product.variants ?? [])
    .filter((v) => v.isActive !== false)
    .map((v) => v.sku)
    .slice(0, 3);
  return {
    id: product.id,
    label: pickTranslation(product.name, locale, '', defaultLocale) || product.slug,
    sublabel: skus.length ? skus.join(', ') : product.slug,
    value: product,
  };
}

/**
 * Server-searched product lookup shared by the manual-order and order-edit
 * screens. Both used to depend on one `pageSize=100` fetch, which put the rest
 * of the catalogue permanently out of reach.
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
          pageSize: ORDER_PICKER_PAGE_SIZE,
          ...(term.trim() ? { search: term.trim() } : {}),
        })
        .pipe(
          map((res) => ({
            options: res.data.map((p) => productOption(p, locale(), defaultLocale())),
            total: res.meta.total,
          })),
        ),
    resolve: (ids) =>
      products.getProduct(ids[0]).pipe(map((p) => [productOption(p, locale(), defaultLocale())])),
  };
}

export function createCustomerSource(users: UsersService): EntitySelectSource<{ id: string }> {
  return {
    search: (term, page) =>
      users
        .listCustomers({
          page,
          pageSize: ORDER_PICKER_PAGE_SIZE,
          ...(term.trim() ? { search: term.trim() } : {}),
        })
        .pipe(
          map((res) => ({
            options: res.data.map((c) => {
              const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
              return {
                id: c.id,
                label: name || (c.email ?? c.id),
                ...(name && c.email ? { sublabel: c.email } : {}),
                value: { id: c.id },
              };
            }),
            total: res.meta.total,
          })),
        ),
  };
}
