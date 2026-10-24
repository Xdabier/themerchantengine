module.exports = {
  displayName: 'admin-services',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/libs/admin-services',
  // Constitution 3.8 floor, ratcheted to the measured level with a few points
  // of headroom so ordinary variation does not fail the gate. Replaces the
  // retired `test-coverage-auditor`, which read the tree and gave an opinion.
  // Raise these when a phase raises the real number; never lower one to go
  // green, which is what `.claude/hooks/config-protection.sh` is there for.
  coverageThreshold: {
    global: {
      statements: 93,
      branches: 72,
      functions: 88,
      lines: 94,
    },
  },
  // 2 workers + 1 GB ceiling per worker keeps the admin-services suite
  // (32 specs, each spinning up Angular TestBed + HttpClient testing) below
  // the default 4 GB heap. workerIdleMemoryLimit recycles the worker before
  // jest-preset-angular's template cache and ts-jest source map cache grow
  // unbounded — see prior CI OOMs at 8 GB.
  maxWorkers: 2,
  workerIdleMemoryLimit: '1024MB',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
        isolatedModules: true,
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  moduleNameMapper: {
    // Better Auth's browser client is ESM-only and drags in an ESM-only
    // dependency tree Jest's CommonJS runtime cannot load. Unit tests never
    // touch the real client — `auth.service.spec.ts` injects a fake via the
    // ADMIN_AUTH_CLIENT token — so it is stubbed here. The real client is
    // exercised by the admin Playwright suite against the live API.
    '^better-auth/client/plugins$': '<rootDir>/src/testing/better-auth-client.mock.ts',
    '^better-auth/client$': '<rootDir>/src/testing/better-auth-client.mock.ts',
  },
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
