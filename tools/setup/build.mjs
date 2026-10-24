// Bundles the stepper to one plain JS file (plan E4.2).
//
//   node tools/setup/build.mjs            -> tools/setup/dist/index.js
//   node tools/setup/build.mjs --out DIR  -> DIR/index.js
//
// Everything the stepper imports is inlined: zod, the shared store-config
// schema and palette generator under libs/, and the S3 client. A box runs the
// result with nothing but Node, before and without the workspace `npm install`.
// esbuild and the two runtime packages resolve from the workspace
// node_modules when it exists and from tools/setup/node_modules otherwise,
// which is what `npm ci --prefix tools/setup` provides on a fresh clone.
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', '..');
const localModules = path.join(here, 'node_modules');
const require = createRequire(path.join(here, 'package.json'));

const outIndex = process.argv.indexOf('--out');
const outDir = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : path.join(here, 'dist');

const rootPackage = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
const esbuild = require('esbuild');

const result = await esbuild.build({
  entryPoints: [path.join(here, 'src', 'index.ts')],
  outfile: path.join(outDir, 'index.js'),
  bundle: true,
  platform: 'node',
  target: ['node20'],
  format: 'cjs',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  nodePaths: [localModules],
  define: {
    __ENGINE_VERSION__: JSON.stringify(rootPackage.version),
  },
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'warning',
  metafile: true,
});

const bytes = fs.statSync(path.join(outDir, 'index.js')).size;
console.log(
  `built ${path.relative(workspace, path.join(outDir, 'index.js'))} (${Math.round(bytes / 1024)} kB)`,
);
if (result.warnings.length > 0) process.exitCode = 1;
