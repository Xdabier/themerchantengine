import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getLocaleDefinition,
  registryLocaleCodes,
} from '../../libs/shared/common/src/locale/locale-registry';
import { registerScratchLocale } from '../../libs/shared/common/src/locale/test-locale-sets';
import { buildFtsSetupSql, buildFtsSetupSqlFromRegistry } from '../fts-setup-sql';

const COMMITTED_SQL = join(__dirname, '..', 'search_fts_setup.sql');

describe('search_fts_setup.sql follows the locale registry', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('the committed file equals the generated one (run `npm run db:fts:generate`)', () => {
    const committed = readFileSync(COMMITTED_SQL, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(buildFtsSetupSqlFromRegistry());
  });

  it('builds one weighted segment and one trigram index per registry locale', () => {
    const sql = buildFtsSetupSqlFromRegistry();
    for (const code of registryLocaleCodes()) {
      const config = getLocaleDefinition(code)?.textSearchConfig;
      expect(sql).toContain(`to_tsvector('${config}'`);
      expect(sql).toContain(`NEW.name->>'${code}'`);
      for (const table of ['Product', 'Category', 'Brand']) {
        expect(sql).toContain(`"${table}_name_${code}_trgm_idx"`);
      }
    }
  });

  it('uses the Arabic text-search configuration, not simple, for ar', () => {
    expect(buildFtsSetupSqlFromRegistry()).toContain(
      "to_tsvector('arabic',\n        COALESCE(NEW.name->>'ar', '')",
    );
  });

  it('has no leftover "locale-specific" warning', () => {
    expect(buildFtsSetupSqlFromRegistry()).not.toMatch(/LOCALE-SPECIFIC/i);
  });

  it('canary: a fourth locale changes the output, so the drift check can fail', () => {
    const before = buildFtsSetupSqlFromRegistry();
    restore = registerScratchLocale('zz', 'ltr');
    const after = buildFtsSetupSqlFromRegistry();
    expect(after).not.toBe(before);
    expect(after).toContain(`NEW.name->>'zz'`);
    expect(after).toContain('"Product_name_zz_trgm_idx"');
    expect(after).toBe(buildFtsSetupSqlFromRegistry());
  });

  it('refuses a locale code or search config that is not a plain identifier', () => {
    const base = getLocaleDefinition('en')!;
    expect(() => buildFtsSetupSql([{ ...base, code: "en'; DROP TABLE x; --" }])).toThrow(
      /locale code/,
    );
    expect(() => buildFtsSetupSql([{ ...base, textSearchConfig: "simple'); --" }])).toThrow(
      /text search config/,
    );
    expect(() => buildFtsSetupSql([])).toThrow(/at least one/);
  });
});
