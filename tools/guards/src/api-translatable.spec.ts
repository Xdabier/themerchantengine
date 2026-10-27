import { expectNoViolations, readRepoFile, lineAt, Violation } from './lib/repo';

/**
 * Constitution 3.2: user-facing text is a Translatable JSONB column, never a
 * bare `String`. A `String` on a storefront-visible entity ships one locale to
 * every visitor, and turning it into a `Json` later is a data migration rather
 * than a schema tweak.
 *
 * Replaces the schema half of the retired `i18n-translatable-auditor`. The
 * admin-edit half (`X-Resolve-Locale: false` on the edit path) is asserted by
 * the admin service unit specs, which send the header and check the response.
 */
const GUARD = 'api-translatable';

const SCHEMA = 'prisma/schema.prisma';

interface UserFacingModel {
  readonly name: string;
  /** Text columns on this model that no visitor ever reads, with the reason.
   * An operator-only label is legitimately a single-locale String. */
  readonly internalFields?: Readonly<Record<string, string>>;
}

/** Models whose text a storefront visitor or a localized email reads. Adding a
 * model here is the deliberate act that puts it under the rule; adding one to
 * the schema without adding it here is what the roster test below catches. */
const USER_FACING_MODELS: readonly UserFacingModel[] = [
  { name: 'Attribute' },
  { name: 'Brand' },
  {
    name: 'Campaign',
    internalFields: {
      name: 'the operator-only campaign label; the sent text is subject and body, both Translatable',
    },
  },
  { name: 'Carrier' },
  { name: 'Category' },
  { name: 'CmsPage' },
  { name: 'Notification' },
  { name: 'NotificationTemplate' },
  { name: 'PaymentMethod' },
  { name: 'Product' },
  { name: 'ProductFaq' },
  { name: 'ProductQuestion' },
  { name: 'ProductSpec' },
  { name: 'ProductType' },
  { name: 'Promotion' },
  { name: 'Review' },
  { name: 'ShippingMethod' },
  { name: 'ShippingZone' },
  { name: 'StorefrontSection' },
  { name: 'TaxZone' },
];

/** Field names that hold prose a human reads. */
const TEXT_FIELDS: ReadonlySet<string> = new Set([
  'altText',
  'answer',
  'body',
  'caption',
  'content',
  'description',
  'heading',
  'label',
  'metaDescription',
  'metaTitle',
  'name',
  'question',
  'shortDescription',
  'subject',
  'summary',
  'title',
]);

export interface Model {
  readonly name: string;
  readonly fields: ReadonlyArray<{ name: string; type: string; line: number }>;
}

export function parseModels(schema: string): Model[] {
  const models: Model[] = [];
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields: Array<{ name: string; type: string; line: number }> = [];
    const bodyStart = match.index + match[0].indexOf('{') + 1;
    let offset = 0;
    for (const line of match[2].split('\n')) {
      const field = /^\s+(\w+)\s+(\w+)/.exec(line);
      if (field)
        fields.push({ name: field[1], type: field[2], line: lineAt(schema, bodyStart + offset) });
      offset += line.length + 1;
    }
    models.push({ name: match[1], fields });
  }
  return models;
}

export function check(
  models: readonly Model[],
  userFacing: readonly UserFacingModel[],
): Violation[] {
  const violations: Violation[] = [];
  for (const { name, internalFields } of userFacing) {
    const model = models.find((m) => m.name === name);
    if (!model) {
      violations.push({
        file: SCHEMA,
        line: 1,
        message: `model "${name}" is on the user-facing list but is not in the schema. Renamed or removed: update the list rather than letting the rule go quiet.`,
      });
      continue;
    }
    for (const field of model.fields) {
      if (!TEXT_FIELDS.has(field.name)) continue;
      if (field.type === 'Json') continue;
      if (internalFields && field.name in internalFields) continue;
      violations.push({
        file: SCHEMA,
        line: field.line,
        message: `${name}.${field.name} is "${field.type}", not a Translatable Json column. User-facing text is Translatable (constitution 3.2).`,
      });
    }
  }
  return violations;
}

describe(GUARD, () => {
  const models = parseModels(readRepoFile(SCHEMA));

  it('keeps every user-facing text column Translatable', () => {
    expectNoViolations(check(models, USER_FACING_MODELS));
  });

  it('reads the whole schema, so a parser regression cannot pass as a clean tree', () => {
    expect(models.length).toBeGreaterThan(50);
  });

  it('holds a roster that still matches the schema', () => {
    const missing = USER_FACING_MODELS.map((m) => m.name).filter(
      (name) => !models.some((m) => m.name === name),
    );
    expect(missing).toEqual([]);
  });

  it('canary: the guard turns red when a user-facing text column is a String', () => {
    const schema = ['model Product {', '  id   String @id', '  name String', '}', ''].join('\n');
    const violations = check(parseModels(schema), [{ name: 'Product' }]);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('Product.name is "String"');
  });

  it('canary: the guard turns red when a listed model leaves the schema', () => {
    const violations = check([], [{ name: 'Product' }]);
    expect(violations[0].message).toContain('is not in the schema');
  });
});
