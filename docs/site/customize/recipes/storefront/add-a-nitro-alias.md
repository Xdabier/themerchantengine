---
title: Add a Nitro alias
description: "Why a server-side import through a tsconfig path alias builds green and fails at runtime on the production storefront, the nitro.alias map in vite.config.ts that fixes it, and the two gates that prove the fix."
primaryQuery: nitro alias tsconfig paths analog production build cannot find package
updated: 2026-09-09
schema: HowTo
---

## When you need this

You wrote a `.server.ts` loader, a Nitro route or a middleware that imports a workspace library through a path alias such as `@storefront-types` or `@common/brand`. The dev server works. The unit tests pass. The production build finishes. Then every page answers 500 with `Cannot find package '@common/...'` or `Invalid module "@storefront-types"`. Nitro bundles the server with its own resolver and does not read the aliases in `tsconfig.base.json`; Vite and the `nxViteTsPaths` plugin only serve the Angular client and SSR bundles. This page shows the alias map that tells Nitro the same thing and the two commands that catch a missing entry before it ships.

## Files you touch

- `apps/storefront/vite.config.ts`: `NITRO_ALIASES`, passed as `nitro.alias` to the Analog plugin. The only place to add an entry.
- `tsconfig.base.json`: the `paths` map the alias mirrors. Read it to find the target file; do not add a server alias here alone.
- `apps/storefront/src/server/api-client.ts`: a server file that imports `@storefront-types`, `@storefront-services` and `@common/store-config-fixtures/store-config-fixture.schema`, the imports the map exists for.
- `apps/storefront/src/server/lib/dedup-store.ts` and `apps/storefront/src/server/middleware/security-headers.ts`: the alternative, a relative import with a comment saying why.
- `apps/storefront/tools/verify-ssr-smoke-runner.cjs` and `apps/storefront/tools/verify-ssr-smoke.cjs`: the gate that boots the production server.
- `package.json`: `test:storefront-ssr-smoke`, which runs the Nx target `storefront:verify-ssr-smoke`.

## The pattern

### 1. Find the alias in tsconfig.base.json

The workspace map in `tsconfig.base.json`:

```json
"@common/*": ["libs/shared/common/src/*"],
"@storefront-types": ["libs/storefront-types/src/index.ts"],
"@storefront-services": ["libs/storefront-services/src/index.ts"]
```

Nitro never reads this. The type side is already covered: `tsc`, the editor and Vitest resolve any `@common/<path>` through the wildcard on line 26 of `tsconfig.base.json`, so an import of a module with no Nitro entry is green everywhere except the server bundle. Anything under `apps/storefront/src/server/**` and every `pages/**/*.server.ts` companion is bundled by Nitro, so an alias used there, directly or through a transitive import, has to be repeated for it; the entry is for the server bundle and nothing else.

### 2. Add the entry to NITRO_ALIASES

`apps/storefront/vite.config.ts` holds the map and passes it through the Analog plugin:

```ts
const NITRO_ALIASES = {
  '@storefront-types': fileURLToPath(
    new URL('../../libs/storefront-types/src/index.ts', import.meta.url),
  ),
  '@storefront-services': fileURLToPath(
    new URL('../../libs/storefront-services/src/index.ts', import.meta.url),
  ),
  '@common/store-config-fixtures/store-config-fixture.schema': fileURLToPath(
    new URL(
      '../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema.ts',
      import.meta.url,
    ),
  ),
  '@common/store-config-fixtures': fileURLToPath(
    new URL('../../libs/shared/common/src/store-config-fixtures/index.ts', import.meta.url),
  ),
  '@common/store-config': fileURLToPath(
    new URL('../../libs/shared/common/src/store-config/index.ts', import.meta.url),
  ),
  '@common/brand': fileURLToPath(
    new URL('../../libs/shared/common/src/brand/index.ts', import.meta.url),
  ),
};

analog({
  ssr: true,
  nitro: {
    ignore: ['**/*.spec.ts'],
    alias: NITRO_ALIASES,
  },
}),
```

Each entry is an absolute file path, not a directory. A wildcard alias like `@common/*` has no equivalent here: name each module you import. Order matters when one key is a prefix of another. Nitro's resolver takes the first prefix match, so the deep `@common/store-config-fixtures/store-config-fixture.schema` entry sits above the bare `@common/store-config-fixtures` one; the other way round, the short entry would shadow it and the deep import would resolve to the barrel.

### 3. Or import relatively and say why

A server module that needs one function from a library can skip the map. `apps/storefront/src/server/middleware/security-headers.ts`:

```ts
// Relative on purpose: Nitro bundles the server without the workspace
// tsconfig aliases, and this module has no alias in `nitro.alias`.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { isProduction } from '../../../../../libs/shared/common/src/env/runtime-environment';
```

The lint disable is required: the module-boundary rule flags a deep relative import into another project. Keep the comment; it is what stops the next reader from "fixing" it back to an alias. The alias form itself is not what lint objects to. `.eslintrc.js` sets `@nx/enforce-module-boundaries` with a `depConstraints` entry that lets `scope:storefront` depend on `scope:shared`, the tag of `libs/shared/common`, and `apps/storefront/src/i18n/types.ts` imports through `@common/` today with no warning. Lint permits the import; Nitro is the side that needs telling.

### 4. Keep the barrel light

`apps/storefront/src/server/api-client.ts` imports the locale list from `@common/store-config-fixtures/store-config-fixture.schema` and not from the `@storefront-services` barrel:

```ts
// The locale set comes from its decorator-free source, not the services
// barrel: Nitro bundles this file with plain esbuild, and a value import of
// the barrel drags every decorated Angular service into that bundle.
import { STORE_CONFIG_LOCALES as STOREFRONT_LOCALES } from '@common/store-config-fixtures/store-config-fixture.schema';
import type { ApiClient, RequestOptions, StorefrontLocale } from '@storefront-services';
```

A `type` import costs nothing; a value import of a barrel that re-exports Angular services pulls decorators into a plain esbuild bundle. Point the alias at the file that holds the value. The same rule applies to `libs/shared/common/src/utils/index.ts`: that barrel re-exports `sanitize-rich-text.ts`, whose first line is `import sanitizeHtml from 'sanitize-html'`, so an alias for `@common/utils` drags that package into the server bundle to reach one regex (the `class-validator` import in `validation-errors.ts` is type-only and is erased). Alias the leaf instead, for example `@common/utils/phone` to `libs/shared/common/src/utils/phone.ts`, which imports nothing.

### 5. Prove it with the production build and the smoke

```bash
npx nx build storefront --configuration=production
npm run test:storefront-ssr-smoke
```

The build alone is not proof: the alias failure happens when Nitro's runtime resolver hits the bundled module on a request, so the server must boot and serve a page that goes through the loader. There is a check that needs no server. After the production build, grep the Nitro output for the bare specifier:

```bash
grep -rl "@common/utils/phone" dist/apps/storefront/analog/server
```

A resolved alias is inlined, so the specifier is gone from `index.mjs` and `chunks/`. If the grep finds it, Nitro left it as a bare package import and the first request that reaches that module answers 500. `apps/storefront/tools/verify-ssr-smoke-runner.cjs` starts `dist/apps/storefront/analog/server/index.mjs` on 53311 with `STOREFRONT_API_URL` pointing at the test API, waits for `Listening on`, and runs `verify-ssr-smoke.cjs`, which requests a filtered catalog page, a search page, a product page and a category deep link with plain GETs and reads the served HTML. A missing alias shows up as a 500 on the first request, which the verifier reports as a failed leg. The Nx target `verify-ssr-smoke` in `apps/storefront/project.json` depends on `build`, so the script rebuilds first.

## Tests to run

```bash
npx nx build storefront --configuration=production
npm run test:storefront-ssr-smoke
npx nx test storefront
npx nx lint storefront
```

- The build compiles the client, the SSR bundle and the Nitro server. It passes with a missing alias; run it because the smoke depends on its output.
- `npm run test:storefront-ssr-smoke` needs the test API on 53001 (the storefront e2e harness spawns it; `.github/workflows/ci.yml` holds one with `scripts/ci/hold-test-api.ts`). Exit 0 is a pass, 1 a page that rendered wrong, 2 a harness or fixture problem. All non-zero codes fail the gate.
- `npx nx test storefront` covers the server modules under Vitest, where the aliases resolve through Vite and a missing Nitro entry is invisible; it is here for the code you touched, not for the alias.
- `npx nx lint storefront` catches a deep relative import without its `eslint-disable` line.

## Gotchas

- The dev server (`npx nx serve storefront`) and every Playwright project resolve aliases through Vite, so none of them can see a missing Nitro entry. The CI job `ssr-smoke` in `.github/workflows/ci.yml` exists for this.
- `nitro.ignore: ['**/*.spec.ts']` is in the same block. Without it a spec file next to a middleware is loaded as a middleware during the Nitro build.
- The Dockerfile at `apps/storefront/Dockerfile` runs `npx nx build storefront --configuration=production` and starts `node analog/server/index.mjs`. An image builds fine with a missing alias and fails on its first request.
- The held test API in CI serves without a global prefix, so the workflow sets `STOREFRONT_API_URL=http://localhost:53001` for the smoke rather than the local default of `http://localhost:53001/api`. Match whichever API you point the smoke at.
- Port 53311 is shared with `serve-production`, `verify-ssr-payloads`, the e2e dev server and Lighthouse. The runner refuses to start when the port already answers; set `STOREFRONT_SMOKE_PORT` to overlap.
- Adding a transitive import inside a library (for example a new `@common/*` import in `libs/storefront-types`) breaks the Nitro bundle of every file that imports that library, even though nothing under `apps/storefront/src/server` changed. Run the smoke when a shared library's imports change.
