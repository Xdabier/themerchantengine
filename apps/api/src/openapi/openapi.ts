import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { version } from '../../../../package.json';

/**
 * The one OpenAPI document of the API, built the same way for the Swagger UI
 * `main.ts` mounts and for the export the public reference is generated from.
 * The DTO schemas come from the `@nestjs/swagger/plugin` entry in
 * `apps/api/nest-cli.json`, which is why the document is only complete when
 * the application was compiled by `nest build`.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('themerchantengine API')
    .setDescription(
      'The REST API of themerchantengine. Storefront and customer routes live under /v1, admin routes under /v1/admin.',
    )
    .setVersion(version)
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Idempotency-Key' }, 'idempotency-key')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/**
 * Every operation of the public reference needs a one-line summary, which is
 * the `@ApiOperation({ summary })` on the controller method. The export refuses
 * a document with a bare operation rather than publishing a page with a hole.
 */
export function assertSummaries(document: OpenAPIObject): void {
  const bare: string[] = [];
  for (const [route, operations] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(
      operations as Record<string, { summary?: string }>,
    )) {
      // A path item also carries path-level keys (`parameters`, `summary`); only the methods are operations.
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue;
      if (!operation.summary?.trim()) bare.push(`${method.toUpperCase()} ${route}`);
    }
  }
  if (bare.length > 0) {
    throw new Error(
      `${bare.length} operation(s) have no @ApiOperation summary:\n  ${bare.join('\n  ')}\nAdd @ApiOperation({ summary }) on each controller method.`,
    );
  }
}

/** The keys of a path item that are operations. */
const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
/** Every admin route starts here; everything else is the storefront audience. */
const ADMIN_PREFIX = '/v1/admin/';
/** The paths an exported document may carry: the versioned API and the bare health probe. */
const KNOWN_ROOTS = ['/v1/', '/health'];

export interface AudienceDocuments {
  storefront: OpenAPIObject;
  admin: OpenAPIObject;
}

/**
 * Splits a document into the two audiences the public reference serves. A
 * path outside `/v1/` and `/health` is refused rather than dropped: the export
 * runs without a global prefix, so such a path is a route registered outside
 * the API's own convention and needs a decision, not a silent omission.
 * Paths and schemas are sorted so the output is byte-stable across runs.
 */
export function splitByAudience(document: OpenAPIObject): AudienceDocuments {
  const paths = Object.keys(document.paths ?? {});
  const stray = paths.filter((p) => !KNOWN_ROOTS.some((root) => p === root || p.startsWith(root)));
  if (stray.length > 0) {
    throw new Error(
      `OpenAPI paths outside ${KNOWN_ROOTS.join(' and ')}: ${stray.join(', ')}. Register the route under /v1 or extend the split on purpose.`,
    );
  }
  const admin = paths.filter((p) => p.startsWith(ADMIN_PREFIX)).sort();
  const storefront = paths.filter((p) => !p.startsWith(ADMIN_PREFIX)).sort();
  return { storefront: subset(document, storefront), admin: subset(document, admin) };
}

const SCHEMA_REF = /^#\/components\/schemas\/(.+)$/;

/** Every schema name a node refers to, at any depth. */
function collectRefs(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, into);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string') {
      const match = SCHEMA_REF.exec(value);
      if (match) into.add(match[1]);
      continue;
    }
    collectRefs(value, into);
  }
}

/**
 * The document reduced to the given paths and to the schemas those paths
 * reach, transitively. A `$ref` to a schema the document does not define is a
 * defect in a decorator and is refused.
 */
function subset(document: OpenAPIObject, keep: string[]): OpenAPIObject {
  const allPaths = document.paths ?? {};
  const paths = Object.fromEntries(keep.map((p) => [p, allPaths[p]]));
  const allSchemas = document.components?.schemas ?? {};
  const referenced = new Set<string>();
  collectRefs(paths, referenced);
  for (let size = -1; size !== referenced.size; ) {
    size = referenced.size;
    for (const name of [...referenced]) {
      if (!(name in allSchemas))
        throw new Error(`$ref to a schema the document does not define: ${name}`);
      collectRefs(allSchemas[name], referenced);
    }
  }
  const schemas = Object.fromEntries(
    [...referenced].sort().map((name) => [name, allSchemas[name]]),
  );
  return {
    ...document,
    paths,
    components: { ...document.components, schemas },
  };
}
