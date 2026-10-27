/**
 * Writes the two OpenAPI documents the public reference is generated from.
 *
 *   node dist/apps/api/openapi-export.js <out-dir>
 *
 * A second entry of the same `nest build` as `main.js`, so the DTO schemas the
 * Swagger CLI plugin adds at compile time are present. It creates the
 * application without listening, builds the document, splits it by audience
 * and exits. No global prefix is set, so every path is the bare `/v1/...`
 * form a deployment proxies however it likes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertSummaries, buildOpenApiDocument, splitByAudience } from './openapi/openapi';

/** The first key of every generated JSON file, checked by the docs guard. */
const GENERATED_BY = 'npm run docs:generate';

async function main(): Promise<void> {
  const outDir = process.argv[2];
  if (!outDir) {
    process.stderr.write('usage: node dist/apps/api/openapi-export.js <out-dir>\n');
    process.exit(2);
  }
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false });
  try {
    const document = buildOpenApiDocument(app);
    assertSummaries(document);
    const { storefront, admin } = splitByAudience(document);
    fs.mkdirSync(outDir, { recursive: true });
    const files: Array<[string, object]> = [
      ['openapi.storefront.json', storefront],
      ['openapi.admin.json', admin],
    ];
    for (const [name, document] of files) {
      const file = path.join(outDir, name);
      fs.writeFileSync(
        file,
        `${JSON.stringify({ 'x-generated-by': GENERATED_BY, ...document }, null, 2)}\n`,
      );
      process.stdout.write(
        `${file}: ${Object.keys((document as { paths: object }).paths).length} paths\n`,
      );
    }
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  },
);
