import type { OpenAPIObject } from '@nestjs/swagger';
import { assertSummaries, splitByAudience } from './openapi';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const op = (summary: string, schema?: string) => ({
  get: {
    summary,
    responses: {
      '200': {
        description: 'ok',
        content: { 'application/json': { schema: schema ? ref(schema) : {} } },
      },
    },
  },
});

/** A document with one admin path, two storefront paths, and a schema chain only the admin path reaches. */
function document(extraPaths: Record<string, unknown> = {}): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: {
      '/v1/products': op('List products', 'ProductDto'),
      '/v1/admin/products': op('List products for the admin', 'AdminProductDto'),
      '/health': op('Health'),
      ...extraPaths,
    } as OpenAPIObject['paths'],
    components: {
      schemas: {
        ProductDto: { type: 'object', properties: { money: ref('MoneyDto') } },
        AdminProductDto: {
          type: 'object',
          properties: { audit: ref('AuditDto'), money: ref('MoneyDto') },
        },
        AuditDto: { type: 'object', properties: { by: ref('StaffDto') } },
        StaffDto: { type: 'object' },
        MoneyDto: { type: 'object' },
        UnusedDto: { type: 'object' },
      },
    },
  };
}

describe('splitByAudience', () => {
  it('puts an admin path in the admin document only and every other path in the storefront one', () => {
    const { storefront, admin } = splitByAudience(document());
    expect(Object.keys(admin.paths)).toEqual(['/v1/admin/products']);
    expect(Object.keys(storefront.paths)).toEqual(['/health', '/v1/products']);
  });

  it('loses no path: the two documents together carry every path once', () => {
    const source = document({ '/v1/cart': op('Cart'), '/v1/admin/orders': op('Orders') });
    const { storefront, admin } = splitByAudience(source);
    const together = [...Object.keys(storefront.paths), ...Object.keys(admin.paths)].sort();
    expect(together).toEqual(Object.keys(source.paths).sort());
  });

  it('keeps only the schemas each audience reaches, transitively, and a schema both reach is in both', () => {
    const { storefront, admin } = splitByAudience(document());
    expect(Object.keys(storefront.components?.schemas ?? {})).toEqual(['MoneyDto', 'ProductDto']);
    expect(Object.keys(admin.components?.schemas ?? {})).toEqual([
      'AdminProductDto',
      'AuditDto',
      'MoneyDto',
      'StaffDto',
    ]);
  });

  it('sorts paths and schemas so the export is byte-stable', () => {
    const source = document({ '/v1/a': op('A'), '/v1/z': op('Z'), '/v1/m': op('M') });
    const { storefront } = splitByAudience(source);
    expect(Object.keys(storefront.paths)).toEqual([
      '/health',
      '/v1/a',
      '/v1/m',
      '/v1/products',
      '/v1/z',
    ]);
  });

  it('refuses a path outside /v1 and /health rather than dropping it', () => {
    expect(() => splitByAudience(document({ '/metrics': op('Metrics') }))).toThrow(
      /outside \/v1\/ and \/health: \/metrics/,
    );
  });

  it('refuses a $ref to a schema the document does not define', () => {
    expect(() => splitByAudience(document({ '/v1/ghost': op('Ghost', 'GhostDto') }))).toThrow(
      /does not define: GhostDto/,
    );
  });
});

describe('assertSummaries', () => {
  it('passes a document whose every operation has a summary', () => {
    expect(() => assertSummaries(document())).not.toThrow();
  });

  it('ignores path-level keys, which are not operations', () => {
    const withPathLevel = document({
      '/v1/shared': {
        ...op('Shared'),
        parameters: [{ name: 'x', in: 'query' }],
        summary: 'path summary',
      },
    });
    expect(() => assertSummaries(withPathLevel)).not.toThrow();
  });

  it('names every operation without a summary, method and path', () => {
    const bare = document({ '/v1/bare': { ...op(''), post: { responses: {} } } });
    expect(() => assertSummaries(bare)).toThrow(
      /2 operation\(s\) have no @ApiOperation summary:\n {2}GET \/v1\/bare\n {2}POST \/v1\/bare/,
    );
  });
});
