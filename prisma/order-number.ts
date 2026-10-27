/**
 * Order numbers for the demo seed, in the format the running application
 * issues (finding AD13).
 *
 * `OrdersService.generateOrderNumber` builds `ORD-{year}-{seq padded to 6}`
 * from a Postgres sequence named `order_seq_{year}`. The seed writes rows
 * directly, so it has to produce the same shape and then reserve what it used,
 * or the first order placed on a freshly seeded database is handed a number
 * that already exists and dies on the unique index.
 *
 * The year is a parameter with a live default rather than a pinned literal.
 * The seed used to hardcode `2026` while reserving `order_seq_{currentYear}`,
 * so a run in any later year stamped rows with one year and reserved a sequence
 * for another.
 */
export const ORDER_NUMBER_PREFIX = 'ORD';

/** How many orders the demo seed writes. The sequence is reserved through this. */
export const SEEDED_ORDER_COUNT = 4;

export function seedOrderNumber(n: number, year: number = new Date().getFullYear()): string {
  return `${ORDER_NUMBER_PREFIX}-${year}-${String(n).padStart(6, '0')}`;
}
