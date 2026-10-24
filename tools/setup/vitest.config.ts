/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Vitest config for the install stepper. The package lives outside every Nx
// application rootDir, so it gets its own runner, like `scripts/` and the
// store-config seeds: `npm run test:setup`.
export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/setup-cli',
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    testTimeout: 120_000,
  },
});
