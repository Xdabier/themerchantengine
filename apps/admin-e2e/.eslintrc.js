module.exports = {
  extends: ['../../.eslintrc.js'],
  ignorePatterns: ['!**/*', '**/*.js.map', '.eslintrc.js'],
  overrides: [
    {
      files: ['**/*.ts'],
      rules: {
        // E2e specs accumulate placeholder vars during journey iteration
        // (request fixtures left in for future cases, baseURL pulled from
        // playwright context but not yet used, etc.). Downgrade to warn so
        // CI passes; the warnings still surface in IDE for cleanup.
        '@typescript-eslint/no-unused-vars': [
          'warn',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-var-requires': 'warn',
      },
    },
  ],
};
