/**
 * The rows an e2e run leaves behind, as data.
 *
 * Plan H. Two consumers share this list: `cleanup-e2e-fixtures.ts`, the
 * one-shot dev repair, and the admin suite's global teardown, which sweeps the
 * TEST database after every run. They must agree, or the sweep quietly stops
 * matching what the repair was written for.
 *
 * Every predicate is anchored on a literal an e2e spec writes on purpose
 * (`E2E Zone `, `e2e_car_`, `https://e2e-webhook-`). None of them is a
 * heuristic: an operator naming a real zone "E2E something" is a mistake this
 * list is allowed to make, but nothing here matches a row that merely looks
 * generated.
 */

/**
 * `soft` mirrors what the module's own admin DELETE endpoint does: stamp
 * `deletedAt` so the Prisma middleware hides the row, and clear the active
 * flag where the table has one. `hard` is for the two tables with no
 * `deletedAt` column at all. `deactivate` never removes anything.
 */
export type FixtureAction = 'soft' | 'hard' | 'deactivate';

export interface FixturePattern {
  /** Table name, exactly as Postgres holds it. */
  table: string;
  action: FixtureAction;
  /** SQL predicate over the table, WITHOUT the soft-delete clause. */
  where: string;
  /** SQL expression printed beside each row id so the operator can read it. */
  label: string;
  /**
   * Extra SET fragment applied with the action. Tables differ: `isActive` on
   * most, `isPublished` on CmsPage, `status` on Product.
   */
  alsoSet?: string;
  /** Why this row exists, for the printed report. */
  note: string;
}

/**
 * The one product an e2e run created that a plan still needs.
 *
 * `e2e-return-widget-1778874947217` carries the raw-HTML description that is
 * the P1 rich-text repro in `docs/storefront-manual-qa-findings.md` section X,
 * and storefront plan D consumes it. Storefront plan K phase K1 patched this
 * exclusion into plan H before it ran, and plan K phase K5 removes it once
 * plan D has landed.
 *
 * The row lives on the dev database seeded by the fixture catalogue. On an
 * install with no such row there are
 * no `e2e-%` products at all, so the exclusion is inert here. It stays anyway,
 * because this script targets whichever database it is pointed at.
 */
export const PRODUCT_KEEP_SLUGS = ['e2e-return-widget-1778874947217'];

const KEEP_LIST_SQL = PRODUCT_KEEP_SLUGS.map((slug) => `'${slug}'`).join(', ');

/**
 * Ordered. Methods before zones, because a method is matched by its own name
 * OR by the zone it hangs off, and a soft-deleted zone would no longer be
 * found by that second half.
 */
export const E2E_FIXTURE_PATTERNS: FixturePattern[] = [
  {
    table: 'ShippingMethod',
    action: 'soft',
    where: `("name"->>'default' ~ '^E2E (Method|FLAT|WEIGHT|PRICE|CARRIER|RENAMED) '
       OR "zoneId" IN (SELECT id FROM "ShippingZone" WHERE "name"->>'default' LIKE 'E2E Zone %'))`,
    label: `"name"->>'default'`,
    alsoSet: `"isActive" = false`,
    note: 'shipping-zones-methods.journey.spec.ts seeds a method per test and deletes only some',
  },
  {
    table: 'ShippingZone',
    action: 'soft',
    where: `"name"->>'default' LIKE 'E2E Zone %'`,
    label: `"name"->>'default'`,
    alsoSet: `"isActive" = false`,
    note: 'the backend exposes no DELETE /shipping/zones/:id, so the spec cannot clean these up',
  },
  {
    table: 'TaxZone',
    action: 'soft',
    where: `"name"->>'default' LIKE 'E2E Zone %'`,
    label: `"name"->>'default'`,
    alsoSet: `"isActive" = false`,
    note: 'tax.journey.spec.ts documents the same missing-DELETE carve-out',
  },
  {
    table: 'Promotion',
    action: 'soft',
    where: `"name"->>'default' LIKE 'E2E promo %'`,
    label: `coalesce("couponCode", "name"->>'default')`,
    alsoSet: `"isActive" = false`,
    note: 'promotions.journey.spec.ts cleans up in a finally that ignores the delete status',
  },
  {
    table: 'WebhookSubscription',
    action: 'hard',
    where: `url LIKE 'https://e2e-webhook-%' AND url LIKE '%.example.com/hook'`,
    label: 'url',
    note: 'no deletedAt column on this model; WebhookDelivery cascades',
  },
  {
    table: 'CmsPage',
    action: 'soft',
    where: `slug LIKE '/e2e-cms-%'`,
    label: 'slug',
    alsoSet: `"isPublished" = false`,
    note: 'cms-pages.journey.spec.ts drafts',
  },
  {
    table: 'Carrier',
    action: 'soft',
    where: `code LIKE 'e2e\\_car\\_%'`,
    label: 'code',
    alsoSet: `"isActive" = false`,
    note: 'the carrier-create journey persists one per run',
  },
  {
    table: 'Product',
    action: 'soft',
    where: `(slug LIKE 'e2e-return-widget-%' OR slug LIKE 'e2e-order-widget-%'
        OR slug LIKE 'e2e-faqgeo-%' OR "name"->>'default' LIKE 'E2E %')
       AND slug NOT IN (${KEEP_LIST_SQL})`,
    label: 'slug',
    alsoSet: `status = 'DRAFT'`,
    note: 'soft only: OrderItem rows reference products and section 3.4 forbids removing them',
  },
  {
    table: 'Role',
    action: 'hard',
    where: `name LIKE 'e2e\\_role\\_%'
       AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."roleId" = "Role".id)`,
    label: 'name',
    note:
      'no deletedAt column; RolePermission cascades. The user check is NOT redundant: ' +
      'User.roleId is onDelete SetNull, so the database would silently strip a real ' +
      'staff account of its role rather than refuse the delete',
  },
  {
    table: 'User',
    action: 'deactivate',
    where: `(email LIKE 'e2e-staff-%@e2e.test' OR email LIKE 'staff.e2e.%@merchants.test'
        OR email LIKE 'e2e-customer-%@e2e.test')`,
    label: 'email',
    alsoSet: `"isActive" = false`,
    note:
      'never deleted: Order.userId is onDelete SetNull, so removing a customer orphans ' +
      'their orders permanently, and the seed converges only on orderNumber so it never ' +
      'repairs them',
  },
];

/** Roles that match the name but are skipped because a user still holds them. */
export const HELD_ROLE_QUERY = `
  SELECT r.id, r.name, (SELECT count(*) FROM "User" u WHERE u."roleId" = r.id) AS users
  FROM "Role" r
  WHERE r.name LIKE 'e2e\\_role\\_%'
    AND EXISTS (SELECT 1 FROM "User" u WHERE u."roleId" = r.id)`;

/**
 * The one StoreSetting an e2e run overwrites and never restores.
 *
 * `settings.journey.spec.ts` writes `support+<timestamp>@merchants.test` and
 * moves on. Deleting the row restores the code default, because `getGroup`
 * merges the defaults in `store.config.ts` under whatever is stored.
 */
export const LEAKED_CONTACT_EMAIL_PREDICATE = `"group" = 'general' AND key = 'contactEmail'
   AND value #>> '{}' ~ '^support\\+[0-9]+@merchants\\.test$'`;

/**
 * Refuse to touch anything but a local dev or test database.
 *
 * Deliberately has no override flag. Every safety valve in this repo that had
 * one eventually got used: the escape hatch plan H just deleted was itself an
 * override for a port clash, and it cost two weeks of dev data. A script that
 * deletes rows does not get one.
 */
export function assertLocalDevOrTestDatabase(url: string | undefined, context: string): string {
  const ALLOWED_HOSTS = ['localhost', '127.0.0.1'];
  const ALLOWED_DATABASES = ['merchants_engine_dev', 'merchants_engine_test'];

  if (!url) throw new Error(`[${context}] DATABASE_URL is not set`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[${context}] DATABASE_URL is not a URL, so its target cannot be verified`);
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    throw new Error(
      `[${context}] refusing to run against host "${parsed.hostname}". ` +
        `Only ${ALLOWED_HOSTS.join(' and ')} are allowed, and there is no override.`,
    );
  }
  if (!ALLOWED_DATABASES.includes(database)) {
    throw new Error(
      `[${context}] refusing to run against database "${database}". ` +
        `Only ${ALLOWED_DATABASES.join(' and ')} are allowed, and there is no override.`,
    );
  }
  return database;
}

/** The stricter form the admin teardown sweep needs: the test database only. */
export function assertTestDatabase(url: string | undefined, context: string): string {
  const database = assertLocalDevOrTestDatabase(url, context);
  if (!database.endsWith('_test')) {
    throw new Error(`[${context}] refusing to sweep "${database}": it is not a _test database`);
  }
  return database;
}
