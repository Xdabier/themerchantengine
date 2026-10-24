/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Vitest config for the repo-root scripts (the client-reference guard and any
// later script spec). Mirrors prisma/vitest.config.ts: these files live outside
// every Nx project rootDir, so they get their own runner via `npm run test:scripts`.
export default defineConfig({
  root: __dirname,
  cacheDir: '../node_modules/.vite/scripts',
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.spec.ts', '*.spec.ts'],
    reporters: ['default'],
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
