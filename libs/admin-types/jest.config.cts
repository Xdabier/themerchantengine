module.exports = {
  displayName: 'admin-types',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: true, dynamicImport: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2022',
          keepClassNames: true,
        },
        module: { type: 'commonjs', lazy: true },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/admin-types',
  // Constitution 3.8 floor, ratcheted to the measured level with a few points
  // of headroom so ordinary variation does not fail the gate. Replaces the
  // retired `test-coverage-auditor`, which read the tree and gave an opinion.
  // Raise these when a phase raises the real number; never lower one to go
  // green, which is what `.claude/hooks/config-protection.sh` is there for.
  coverageThreshold: {
    global: {
      statements: 77,
      branches: 79,
      functions: 86,
      lines: 89,
    },
  },
  maxWorkers: 4,
  workerIdleMemoryLimit: '512MB',
};
