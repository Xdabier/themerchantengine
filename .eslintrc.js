// Restricted-syntax entries shared by the repo-wide rule and the per-lane
// overrides. ESLint replaces a rule wholesale when an override redefines it,
// so an override that wants one more entry has to restate the others; naming
// them once here is what keeps the two lists from drifting.
const assetVariantRestrictions = [
  {
    selector: 'CallExpression[callee.property.name="getUrlsByIds"]',
    message:
      'getUrlsByIds() was removed in asset-variant-serving (AV1). Use AssetsService.publicProjection(ids, intent) for bulk variant URLs or pickVariantUrl(asset, intent) for the per-asset resolver. See agent_docs/assets-pipeline.md §1.',
  },
  {
    selector: 'Identifier[name="getUrlsByIds"]',
    message:
      'getUrlsByIds was removed in asset-variant-serving (AV1). Use AssetsService.publicProjection(ids, intent) or pickVariantUrl(asset, intent).',
  },
];

// Constitution §3.10 / §3.11. The tree carries zero uses today: every mention
// is a comment saying the code deliberately does not reach for it, so this
// lands as an error rather than a baselined warning. The rest of the retired
// post-edit.sh style rules live in `tools/guards/src/lane-styling.spec.ts`,
// because most of their surface is .html and .css that no TS parser reads.
const sanitizerBypassRestrictions = [
  {
    selector: 'MemberExpression[property.name=/^bypassSecurityTrust/]',
    message:
      'bypassSecurityTrust* disables Angular sanitization. Render as text, or sanitize server-side with sanitize-html and document why (constitution §3.10 / §3.11).',
  },
  {
    selector: 'CallExpression[callee.property.name=/^bypassSecurityTrust/]',
    message:
      'bypassSecurityTrust* disables Angular sanitization. Render as text, or sanitize server-side with sanitize-html and document why (constitution §3.10 / §3.11).',
  },
];

module.exports = {
  parser: '@typescript-eslint/parser',
  // `parserOptions.project` removed — the active rule set (`@typescript-eslint/
  // recommended`, `@nx/enforce-module-boundaries`, prettier) is entirely syntactic
  // and does not consume type information. The previous config eagerly built the
  // full ts.Program for every lint invocation, which forced the CI lint job onto
  // an 8 GB heap (and still OOMed). If a type-aware rule is added later, scope it
  // to a single override with `parserOptions.projectService: true` (typescript-eslint
  // v8+) so the cost stays local to that override.
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022,
  },
  plugins: ['@typescript-eslint/eslint-plugin', '@nx'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    '.eslintrc.js',
    '**/*.d.ts',
    '**/*.js',
    '**/*.js.map',
    'dist/**',
    'node_modules/**',
    '.nx/**',
    'coverage/**',
    'apps/api/test/**',
  ],
  overrides: [
    {
      // prisma/ is a script tree with no project tag, and the boundary rule's
      // autofix crashes on its cross-project relative imports (it tries to
      // read the unexpanded `@config/*` mapping as a file), which took the
      // whole lint job down the first time CI ran it over the project. The
      // seeds' runtime imports are guarded by scripts/__tests__/dockerfiles.spec.ts.
      files: ['prisma/**/*.ts'],
      rules: {
        '@nx/enforce-module-boundaries': 'off',
        // The seed specs name ignored mock arguments `_args`, the usual form.
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      },
    },
    {
      // AV3 — `originalStoragePath` is private storage metadata. Reading it
      // outside the canonical owners (assets module, upload pipeline, the
      // admin asset-detail page's "Download original" disabled-state gate,
      // and the assets-variant-serving e2e fixture) is a signal that a
      // caller is reaching into private state instead of going through the
      // signed-URL endpoint. Scoped via `excludedFiles` so the rule only
      // fires on files outside the legitimate readers.
      files: ['**/*.ts'],
      excludedFiles: [
        'apps/api/src/modules/assets/**/*.ts',
        'libs/admin-services/src/assets/**/*.ts',
        'libs/admin-services/src/products/**/*.ts',
        'apps/admin/src/app/features/assets/**/*.ts',
        'apps/admin/src/app/features/products/**/*.ts',
        'test/**/assets-variant-serving.e2e-spec.ts',
        // The catalogue seed's image pipeline ingests originals and deletes them
        // when originals are not retained; it is an owner of that path.
        'prisma/seeds/fixture-catalogue/lib/image-pipeline.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...assetVariantRestrictions,
          ...sanitizerBypassRestrictions,
          {
            selector: 'MemberExpression[property.name="originalStoragePath"]',
            message:
              'originalStoragePath is private storage metadata. Read it only inside `apps/api/src/modules/assets/**` or via `AssetsService.getOriginalUrl(id)` for the admin signed-URL flow. See agent_docs/assets-pipeline.md §1.',
          },
        ],
      },
    },
  ],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    // Asset-variant-serving (AV1) — forbid the legacy bulk URL helper. The
    // canonical bulk projection is `AssetsService.publicProjection(ids, intent)`
    // and the per-asset resolver is `pickVariantUrl(asset, intent)` from
    // `@common/asset-variants`. The full typed rule (flagging `.url`
    // member access on Asset-shaped expressions outside the assets module)
    // lands at AV3 alongside admin template migration — see
    // `specs/features/asset-variant-serving/tasks.md` AV1.26 entry note.
    'no-restricted-syntax': ['error', ...assetVariantRestrictions, ...sanitizerBypassRestrictions],
    '@nx/enforce-module-boundaries': [
      'warn',
      {
        enforceBuildableLibDependency: true,
        // `@common/*` is deliberately NOT exempt: it is the alias every scope
        // reaches the shared library through, so exempting it meant the
        // depConstraints below could not fire for the one import form anybody
        // writes. Every scope already permits `scope:shared`, so applying the
        // rule to it forbids nothing that was legal.
        allow: ['@/*', '@modules/*', '@config/*'],
        depConstraints: [
          {
            sourceTag: 'scope:api',
            onlyDependOnLibsWithTags: ['scope:shared', 'scope:api'],
          },
          {
            sourceTag: 'scope:shared',
            onlyDependOnLibsWithTags: ['scope:shared'],
          },
          {
            sourceTag: 'scope:admin',
            onlyDependOnLibsWithTags: ['scope:admin', 'scope:shared'],
          },
          // The storefront reads the runtime config and the palette generator
          // out of the shared library since plan E2, so it gets the same rule
          // the admin has. Without an entry the tag was unconstrained, which
          // meant the boundary was neither enforced nor knowingly waived.
          {
            sourceTag: 'scope:storefront',
            onlyDependOnLibsWithTags: ['scope:storefront', 'scope:shared'],
          },
        ],
      },
    ],
    'prettier/prettier': [
      'error',
      {
        endOfLine: 'auto',
      },
    ],
  },
};
