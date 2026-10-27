/**
 * Custom webpack config for the merchants-engine API build.
 *
 * Better Auth (and its dependency ecosystem) is ESM-only, but the API compiles
 * to CommonJS via the NestJS webpack builder. The builder externalises every
 * node_module by default, which would leave `require('better-auth')` as a CJS
 * require of an ESM package — a runtime failure.
 *
 * This config keeps the default "externalise node_modules" behaviour for
 * everything EXCEPT the Better Auth ecosystem, which is bundled into the
 * output (webpack transpiles its ESM down to CJS at build time).
 *
 * NestJS / Prisma / native addons (bcrypt, sharp) MUST stay external — native
 * `.node` binaries cannot be bundled, Prisma ships a generated client + query
 * engine, and NestJS resolves several optional packages via dynamic require.
 *
 * Internal workspace code reached through a tsconfig path alias (`@common/*`,
 * `@modules/*`, `@config/*`, `@merchants/shared-common`, `@/*`) MUST be bundled
 * — it is app code, not a node_module. A prefix-only classification cannot tell
 * an alias (`@common/middleware`) apart from an npm scope (`@nestjs/common`),
 * so a bare specifier is resolved through webpack's own resolver (the NestJS
 * builder installs TsconfigPathsPlugin into `resolve.plugins`): a request that
 * resolves inside the workspace is bundled, one that resolves under
 * `node_modules` is externalised.
 *
 * Discovered + decided in phase BA2 — see
 * specs/features/better-auth-migration/phase-0-findings.md Part D. The
 * resolver-based externals classification (replacing the earlier prefix-only
 * function that wrongly externalised every `@`-aliased internal import and so
 * crashed the boot with `Cannot find module '@common/middleware'`) landed in
 * task BA2.9b.
 */
const path = require('path');
const { builtinModules } = require('module');

// The Better Auth ESM ecosystem — bundled into the API output rather than
// left as an external CommonJS require().
const BUNDLE_ESM =
  /^(better-auth|@better-auth\/|better-call|@better-fetch\/|@noble\/|jose|kysely|nanostores|defu)(\/|$)/;

// Node built-ins (`fs`, `crypto`, `node:crypto`, …) — always external.
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

module.exports = (config) => {
  // Lazily cached resolver — `getResolve()` builds a resolver that honours the
  // compilation's full `resolve` config, TsconfigPathsPlugin included.
  let resolve;

  return {
    ...config,
    // Two entries from the one compilation: the server, and the OpenAPI
    // export the public reference is generated from. The export shares the
    // build so the Swagger CLI plugin's DTO schemas are in it; a ts-node run
    // would compile without the plugin and export bare endpoints.
    entry: {
      main: config.entry,
      'openapi-export': path.join(__dirname, 'src', 'openapi-export.ts'),
    },
    // Pin the bundles to dist/apps/api/<entry>.js so main.js matches the Nx
    // `outputs` declaration in project.json (the NestJS webpack builder
    // otherwise emits to dist/main.js).
    output: {
      ...config.output,
      path: path.join(process.cwd(), 'dist', 'apps', 'api'),
      filename: '[name].js',
    },
    optimization: {
      ...config.optimization,
      // Node-target server bundle: scope hoisting (module concatenation)
      // yields only a marginal size benefit here and is a known
      // circular-dependency hazard. The app's compiled output is CommonJS
      // (see apps/api/tsconfig.build.json), so its benign import cycles
      // resolve via partial exports the way Node loads them; keeping
      // concatenation off preserves that per-module isolation. (BA2.9b.)
      concatenateModules: false,
    },
    externals: [
      async ({ context, request, getResolve }) => {
        if (!request) return undefined;
        // Relative / absolute specifiers are always app code → bundle.
        if (request.startsWith('.') || path.isAbsolute(request)) {
          return undefined;
        }
        // Node built-ins → emitted as an external require().
        if (NODE_BUILTINS.has(request)) {
          return 'commonjs ' + request;
        }
        // Better Auth ESM ecosystem → bundle (transpile ESM → CJS).
        if (BUNDLE_ESM.test(request)) {
          return undefined;
        }
        // Any other bare specifier is either a node_modules package or an
        // internal tsconfig path alias. Resolve it the way webpack would and
        // classify by the resolved location.
        try {
          resolve = resolve ?? getResolve();
          const resolved = await resolve(context, request);
          // `node_modules` in the resolved path → a real dependency → external.
          if (resolved.split(path.sep).includes('node_modules')) {
            return 'commonjs ' + request;
          }
          // Resolved inside the workspace → app code → bundle.
          return undefined;
        } catch {
          // Unresolvable — leave it as an external require() rather than
          // failing the build; a genuinely missing module surfaces at runtime.
          return 'commonjs ' + request;
        }
      },
    ],
  };
};
