import { map } from 'rxjs';
import type { ProductsService, SpecLabelOption } from '@admin-services';
import { pickTranslation, type Translatable } from '@admin-types';
import type {
  EntityOption,
  EntitySelectSource,
} from '../../shared/entity-select/entity-select.types';

const SPEC_LABEL_PAGE_SIZE = 20;

function labelOption(
  row: SpecLabelOption,
  locale: string,
  defaultLocale: string,
): EntityOption<SpecLabelOption> {
  return {
    // The folded key is the option's identity, which is exactly what the server
    // treats as the label's identity too.
    id: row.key,
    label: pickTranslation(
      row.label as Translatable | null | undefined,
      locale,
      row.key,
      defaultLocale,
    ),
    // The only in-context signal that a label sits near the storefront facet
    // coverage bar. The grid deliberately does not try to predict whether a
    // save flips a filter on or off: those thresholds are env-tunable and the
    // admin does not read that env, so any prediction would be a confident lie
    // on a box configured differently.
    sublabel: `used on ${row.productCount} ${row.productCount === 1 ? 'product' : 'products'}`,
    // Carries the whole Translatable, which is what lets picking an existing
    // label fill every locale column at once.
    value: row,
  };
}

/**
 * Label corpus for the specifications matrix.
 *
 * Backed by `listSpecLabels`, NOT by the storefront facet rail: that one sees
 * only ACTIVE products and then applies viability bars, so an operator writing
 * the first or second product to use a label would not find it in their own
 * autocomplete.
 *
 * No `resolve`. The matrix never binds a persisted id into the combobox; it
 * seeds its label cells straight from the product payload and uses the combobox
 * purely as an assist for editing them. Adding a `resolve` here would imply the
 * control owns the value, which it does not.
 */
export function createSpecLabelSource(
  products: ProductsService,
  locale: () => string,
  defaultLocale: () => string,
): EntitySelectSource<SpecLabelOption> {
  return {
    search: (term, page) =>
      products
        .listSpecLabels({
          page,
          pageSize: SPEC_LABEL_PAGE_SIZE,
          ...(term.trim() ? { search: term.trim() } : {}),
        })
        .pipe(
          map((res) => ({
            options: res.data.map((row) => labelOption(row, locale(), defaultLocale())),
            total: res.meta.total,
          })),
        ),
  };
}
