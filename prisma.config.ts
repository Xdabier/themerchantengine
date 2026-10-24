// Prisma 7 configuration — database URL moved here from schema.prisma
// See: https://pris.ly/d/config-datasource
import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    // npx prefix forces resolution via node_modules/.bin so prisma's raw
    // child_process.spawn() finds ts-node. Without npx, prod containers
    // (and any host without ts-node on the OS PATH) error with
    // `spawn ts-node ENOENT` — spawn doesn't search node_modules/.bin.
    seed: 'npx ts-node prisma/seed.ts',
  },
});
