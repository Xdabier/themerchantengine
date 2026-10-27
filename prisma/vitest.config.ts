/// <reference types="vitest" />
import { resolve } from 'path';
import { defineConfig } from 'vite';

// Vitest config for the prisma-root scripts (NE3 notification-template defaults
// + backfill). Kept separate
// from the Nx jest projects because these scripts live outside any app's
// rootDir; run via `npm run test:notification-defaults`.
export default defineConfig({
  root: __dirname,
  cacheDir: '../node_modules/.vite/notification-defaults',
  resolve: {
    // The mail templates the defaults spec imports read the store locale set
    // through the `@common/*` path alias from `tsconfig.base.json`.
    alias: { '@common': resolve(__dirname, '..', 'libs', 'shared', 'common', 'src') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.spec.ts'],
    reporters: ['default'],
    testTimeout: 30_000,
  },
});
