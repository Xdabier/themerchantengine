module.exports = {
  rules: {
    // Constitution 3.5: `unknown` at the boundary, narrowed at once. Warn
    // repo-wide because the api tree carries 21; an error on this lane, which
    // carries none. It lives in the lane's own config rather than in a root
    // `overrides` block: ESLint resolves an extended config's override globs
    // relative to the extending config, so `apps/admin/**` written at the root
    // would resolve to `apps/admin/apps/admin/**` here and match nothing.
    '@typescript-eslint/no-explicit-any': 'error',
  },
  extends: ['../../.eslintrc.js'],
  ignorePatterns: [
    '!**/*',
    // '!**/*' above re-includes everything the root config ignored, build
    // output included. Analog writes its bundles into this project's own
    // dist/ and .nitro/, so without these the lane lints minified vendor
    // JavaScript and generated .d.ts files: 1800 findings, none of them source.
    'dist/**',
    '.nitro/**',
    '.angular/**',
    '**/*.js.map',
    'vite.config.ts',
    'postcss.config.cjs',
    'tailwind.config.js',
    '.eslintrc.js',
  ],
  overrides: [
    {
      files: ['*.html'],
      parser: '@angular-eslint/template-parser',
      plugins: ['@angular-eslint/template'],
      rules: {
        'prettier/prettier': 'off',
      },
    },
  ],
};
