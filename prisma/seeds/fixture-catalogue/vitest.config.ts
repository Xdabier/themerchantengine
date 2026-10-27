/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/fixture-catalogue-seed',
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.spec.ts'],
    reporters: ['default'],
    testTimeout: 30_000,
  },
});
