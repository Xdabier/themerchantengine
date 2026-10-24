/* eslint-disable */
export default {
  displayName: 'api-e2e',
  preset: '../jest.preset.js',
  moduleFileExtensions: ['ts', 'js', 'json'],
  roots: ['<rootDir>', '<rootDir>/../apps/api/test'],
  testEnvironment: 'node',
  testMatch: ['**/*.e2e-spec.ts'],
  maxWorkers: 1,
  // The backend e2e suite runs OUT OF PROCESS: globalSetup boots a
  // webpack-bundled API on :53001 against the test stack and the specs are
  // HTTP clients. jest therefore never imports the NestJS app — and never
  // Better Auth's ESM-only packages, which the CJS jest runtime cannot load.
  globalSetup: '<rootDir>/e2e-global-setup.ts',
  globalTeardown: '<rootDir>/e2e-global-teardown.ts',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../apps/api/tsconfig.spec.json',
        isolatedModules: true,
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../apps/api/src/$1',
    '^@modules/(.*)$': '<rootDir>/../apps/api/src/modules/$1',
    '^@common/(.*)$': '<rootDir>/../libs/shared/common/src/$1',
    '^@permissions$': '<rootDir>/../libs/shared/permissions/src/index.ts',
    '^@config/(.*)$': '<rootDir>/../apps/api/src/config/$1',
  },
  workerIdleMemoryLimit: '768MB',
};
