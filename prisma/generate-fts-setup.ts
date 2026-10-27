/**
 * Regenerates `prisma/search_fts_setup.sql` from the locale registry. Run it
 * after adding a language: `npm run db:fts:generate`, then `npm run db:fts`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildFtsSetupSqlFromRegistry } from './fts-setup-sql';

const SQL_PATH = path.resolve(__dirname, 'search_fts_setup.sql');

fs.writeFileSync(SQL_PATH, buildFtsSetupSqlFromRegistry(), 'utf8');
// eslint-disable-next-line no-console
console.log(`[db:fts:generate] wrote ${SQL_PATH}`);
