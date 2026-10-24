/* eslint-disable */
// Architecture guards. Every spec is a static scan of the repository source
// tree, so this project has no application dependencies and no DI graph to
// build: @swc/jest keeps a full run under a couple of seconds.
//
// The guards read the tree from disk rather than from Nx's project graph, so
// they are never "unaffected". `npm run gate` runs `nx run guards:test`
// explicitly for that reason.
export default {
  displayName: 'guards',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Canary fixtures are named like the specs they mimic so a guard sees the
  // same path shape it sees in the real tree. Jest must not try to run them.
  testPathIgnorePatterns: ['<rootDir>/src/__fixtures__/'],
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
          target: 'es2022',
          keepClassNames: true,
        },
        module: { type: 'commonjs' },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // The route and permission guards compare the tree against the same shared
  // constants the controllers import, not against a copy.
  moduleNameMapper: {
    '^@admin-routes$': '<rootDir>/../../libs/shared/admin-routes/src/index.ts',
    '^@permissions$': '<rootDir>/../../libs/shared/permissions/src/index.ts',
  },
  coverageDirectory: '../../coverage/tools/guards',
  maxWorkers: 4,
  workerIdleMemoryLimit: '512MB',
};
