/**
 * Recurrence guard for the customer-facing projections (plan J Phase J4).
 *
 * Plan J hardened five surfaces that were handing raw Prisma rows to customers.
 * The fix is only durable if the NEXT column added to one of those models
 * cannot silently ride out the same way, so this spec reads
 * `prisma/schema.prisma` at test time and requires every column of each
 * hardened model to be explicitly classified as customer-visible or as
 * withheld.
 *
 * A migration that adds a column and touches nothing else fails here. That is
 * the point: the failure asks someone to decide which list the new column
 * belongs in, rather than defaulting it onto the wire.
 *
 * The second half is a recursive key scan for the field names this plan
 * removed, so a future nested `include` cannot reintroduce one at depth.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  CUSTOMER_ORDER_FIELDS,
  CUSTOMER_ORDER_MONEY_FIELDS,
  CUSTOMER_ORDER_RELATIONS,
  toCustomerOrder,
} from '../modules/orders/orders.serializer';
import { PUBLIC_VARIANT_SELECT } from '../modules/products/products.constants';
import { QUESTION_PUBLIC_SELECT } from '../modules/reviews/reviews.service';
import { toCustomerReturn } from '../modules/returns/returns.service';
import { PROFILE_INTERNAL_FIELDS } from '../modules/users/users.service';

const SCHEMA_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'prisma', 'schema.prisma');

/**
 * Names the schema declares as `model X`. A field whose type is one of these is
 * a relation; everything else (including enums) is a scalar column.
 */
function declaredModels(schema: string): Set<string> {
  return new Set([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));
}

/** Every scalar column of a model, in declaration order. */
function scalarColumnsOf(model: string): string[] {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const models = declaredModels(schema);

  const start = schema.search(new RegExp(`^model\\s+${model}\\s*\\{`, 'm'));
  if (start === -1) throw new Error(`model ${model} not found in ${SCHEMA_PATH}`);
  const end = schema.indexOf('\n}', start);
  const body = schema.slice(schema.indexOf('{', start) + 1, end);

  const columns: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
    const match = /^(\w+)\s+(\w+)/.exec(line);
    if (!match) continue;
    const [, name, type] = match;
    if (models.has(type)) continue; // relation, not a column
    columns.push(name);
  }
  return columns;
}

/** Every key at every depth of a serialized payload. */
function keysAtEveryDepth(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) keysAtEveryDepth(entry, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      found.add(key);
      keysAtEveryDepth(child, found);
    }
  }
  return found;
}

/**
 * Names plan J removed from customer responses. None may appear at any depth of
 * any customer payload, whatever nesting a later change introduces.
 */
const FORBIDDEN_CUSTOMER_FIELDS = [
  'internalNotes',
  'idempotencyKey',
  'costPrice',
  'licenseKey',
  'barcode',
  'adminNotes',
  'answeredBy',
  'askedById',
  'passwordHash',
  'emailDeliverability',
  'emailBouncedAt',
  'emailComplainedAt',
  'availableStock',
  // A guest order's session id is the only thing needed to read that order.
  // Treated like a secret rather than an identifier, so the deep scan asserts
  // it never surfaces at any depth.
  'guestSessionId',
  // Soft-delete state. Not on any model the recursive scan below walks, so it
  // is here for the profile strip and the variant select to agree with.
  'deletedAt',
];

/** A row with every scalar column present, so nothing is absent by accident. */
function fullyPopulated(model: string): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const column of scalarColumnsOf(model)) row[column] = `${model}.${column}`;
  return row;
}

function unclassified(model: string, ...lists: readonly (readonly string[])[]): string[] {
  const classified = new Set(lists.flat());
  return scalarColumnsOf(model).filter((column) => !classified.has(column));
}

describe('customer-facing projections — fail closed on a new column (plan J K7)', () => {
  it('parses the schema it guards against', () => {
    // If this breaks, every other assertion below is vacuous.
    expect(scalarColumnsOf('Order')).toEqual(expect.arrayContaining(['id', 'internalNotes']));
    expect(scalarColumnsOf('Order')).not.toContain('items');
  });

  // ── Order (finding AD2) ──────────────────────────────────────────────────

  describe('Order', () => {
    /** Withheld on purpose. Each is argued in orders.serializer.ts. */
    const ADMIN_ONLY = [
      'internalNotes',
      'idempotencyKey',
      'userId',
      // The bearer credential for a guest order. Whoever holds it can read the
      // order, so it never travels in a response body.
      'guestSessionId',
      // Internal mail plumbing; nothing to say to a customer.
      'guestLocale',
      // The provider's own id; webhooks resolve the order by it.
      'paymentReference',
    ];

    it('classifies every Order column as customer-visible or withheld', () => {
      expect(
        unclassified('Order', CUSTOMER_ORDER_FIELDS, CUSTOMER_ORDER_MONEY_FIELDS, ADMIN_ONLY),
      ).toEqual([]);
    });

    it('serializes a fully-populated row to exactly the allowlist', () => {
      const output = toCustomerOrder({
        ...fullyPopulated('Order'),
        subtotal: 1,
        discountAmount: 2,
        shippingAmount: 3,
        taxAmount: 4,
        total: 5,
        items: [],
        shipments: [],
        invoice: null,
        user: { id: 'u-1', email: 'admin@example.com' },
      });

      expect(Object.keys(output).sort()).toEqual(
        [...CUSTOMER_ORDER_FIELDS, ...CUSTOMER_ORDER_MONEY_FIELDS, ...CUSTOMER_ORDER_RELATIONS]
          .slice()
          .sort(),
      );
    });

    it('carries no forbidden key at any depth, including under the relations', () => {
      const output = toCustomerOrder({
        ...fullyPopulated('Order'),
        items: [{ ...fullyPopulated('OrderItem'), internalNotes: 'nested leak canary' }],
        shipments: [fullyPopulated('Shipment')],
        invoice: fullyPopulated('Invoice'),
        user: { id: 'u-1' },
      });

      // The canary proves the scan reaches into `items`, not just the top level.
      expect(keysAtEveryDepth(output)).toContain('internalNotes');

      const clean = toCustomerOrder({
        ...fullyPopulated('Order'),
        items: [fullyPopulated('OrderItem')],
        shipments: [fullyPopulated('Shipment')],
        invoice: fullyPopulated('Invoice'),
        user: { id: 'u-1' },
      });
      const keys = keysAtEveryDepth(clean);
      for (const forbidden of FORBIDDEN_CUSTOMER_FIELDS) {
        expect(keys).not.toContain(forbidden);
      }
      expect(keys).not.toContain('user');
    });
  });

  // ── ProductVariant (sweep S1, pass-2 P5) ─────────────────────────────────

  describe('ProductVariant', () => {
    /**
     * Withheld on purpose. `costPrice` and `licenseKey` are the security half;
     * the rest is internal or simply unread by any client. The pass-2 names are
     * pinned here by name so the observation cannot be re-lost.
     */
    const WITHHELD = [
      'costPrice',
      'licenseKey',
      'barcode',
      'maxDownloads',
      'downloadExpiryDays',
      'weight',
      'length',
      'width',
      'height',
      'isActive',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ];

    it('classifies every ProductVariant column as public or withheld', () => {
      expect(unclassified('ProductVariant', Object.keys(PUBLIC_VARIANT_SELECT), WITHHELD)).toEqual(
        [],
      );
    });

    it('selects nothing forbidden, and no relation join', () => {
      const selected = Object.keys(PUBLIC_VARIANT_SELECT);
      for (const forbidden of [...FORBIDDEN_CUSTOMER_FIELDS, 'attributeValues', 'stockLevels']) {
        expect(selected).not.toContain(forbidden);
      }
    });
  });

  // ── ProductQuestion (sweep S2) ───────────────────────────────────────────

  describe('ProductQuestion', () => {
    const WITHHELD = ['askedById', 'answeredBy'];

    it('classifies every ProductQuestion column as public or withheld', () => {
      expect(
        unclassified('ProductQuestion', Object.keys(QUESTION_PUBLIC_SELECT), WITHHELD),
      ).toEqual([]);
    });

    it('never selects the asker id through the relation either', () => {
      expect(QUESTION_PUBLIC_SELECT.asker.select).not.toHaveProperty('id');
    });
  });

  // ── Return (sweep S3) ────────────────────────────────────────────────────

  describe('Return', () => {
    const WITHHELD = ['adminNotes'];

    it('drops adminNotes and keeps every other column', () => {
      const output = toCustomerReturn({
        ...fullyPopulated('Return'),
        items: [fullyPopulated('ReturnItem')],
      }) as Record<string, unknown>;

      const expected = scalarColumnsOf('Return').filter((column) => !WITHHELD.includes(column));
      expect(Object.keys(output).sort()).toEqual([...expected, 'items'].sort());
    });

    it('carries no forbidden key at any depth', () => {
      const keys = keysAtEveryDepth(
        toCustomerReturn({
          ...fullyPopulated('Return'),
          items: [fullyPopulated('ReturnItem')],
          photos: [fullyPopulated('ReturnAsset')],
        }),
      );
      for (const forbidden of FORBIDDEN_CUSTOMER_FIELDS) {
        expect(keys).not.toContain(forbidden);
      }
    });
  });

  // ── User profile (sweep S4) ──────────────────────────────────────────────

  describe('User profile', () => {
    it('withholds exactly the mail-ops trio, the soft-delete column and the hash', () => {
      // Deliberately NOT an exhaustive classification of `User`: this endpoint
      // is shared with the admin dashboard bootstrap, so the safe rule is a
      // named strip, not an allowlist. What must hold is that everything named
      // is in the forbidden list, so no other guard contradicts it.
      for (const field of PROFILE_INTERNAL_FIELDS) {
        expect(FORBIDDEN_CUSTOMER_FIELDS).toContain(field);
      }
      expect(scalarColumnsOf('User')).toEqual(expect.arrayContaining([...PROFILE_INTERNAL_FIELDS]));
    });
  });
});
