import {
  FTS_COLUMN_NAME,
  FTS_REPAIR_COMMAND,
  FTS_TRIGGER_NAME,
  assertFtsIntegrity,
  evaluateFtsIntegrity,
  ftsCheckApplies,
  probeFtsIntegrity,
  type FtsQuery,
} from './fts-integrity';
import { registerScratchLocale } from '@common/locale';

const ALL_LOCALES_SOURCE = [
  "to_tsvector('french', unaccent(COALESCE(NEW.name->>'fr','')))",
  "to_tsvector('english', unaccent(COALESCE(NEW.name->>'default','') || ' ' || COALESCE(NEW.name->>'en','')))",
  "to_tsvector('arabic', COALESCE(NEW.name->>'ar',''))",
  "to_tsvector('simple', unaccent(array_to_string(NEW.tags, ' ')))",
].join(' || ');

/**
 * Mocked `information_schema`. `hasTrigger` / `hasColumn` decide what each of
 * the two catalogue lookups returns, so a spec can build any of the four states
 * the tripwire distinguishes without a database.
 */
function mockQuery(state: {
  hasTrigger: boolean;
  hasColumn: boolean;
  functionSource?: string;
}): jest.Mock<Promise<unknown[]>> {
  return jest.fn(async (sql: string) => {
    if (sql.includes('pg_proc')) return [{ prosrc: state.functionSource ?? ALL_LOCALES_SOURCE }];
    if (sql.includes('information_schema.triggers'))
      return state.hasTrigger ? [{ '?column?': 1 }] : [];
    if (sql.includes('information_schema.columns'))
      return state.hasColumn ? [{ '?column?': 1 }] : [];
    throw new Error(`unexpected query: ${sql}`);
  }) as jest.Mock<Promise<unknown[]>>;
}

describe('fts-integrity', () => {
  describe('evaluateFtsIntegrity', () => {
    it('refuses the broken state: trigger present, column absent', () => {
      const verdict = evaluateFtsIntegrity({ hasTrigger: true, hasColumn: false });

      expect(verdict.ok).toBe(false);
      expect(verdict.message).toContain(FTS_TRIGGER_NAME);
      expect(verdict.message).toContain(FTS_COLUMN_NAME);
      // The whole point of the message is that it names the repair.
      expect(verdict.message).toContain(FTS_REPAIR_COMMAND);
    });

    it('passes the healthy state: both present', () => {
      expect(evaluateFtsIntegrity({ hasTrigger: true, hasColumn: true })).toEqual({ ok: true });
    });

    it('passes a fresh database: neither present, which is valid before db:setup', () => {
      expect(evaluateFtsIntegrity({ hasTrigger: false, hasColumn: false })).toEqual({ ok: true });
    });

    it('warns but does not refuse when the column exists without its trigger', () => {
      const verdict = evaluateFtsIntegrity({ hasTrigger: false, hasColumn: true });

      expect(verdict.ok).toBe(true);
      expect(verdict.message).toContain(FTS_REPAIR_COMMAND);
    });
  });

  describe('probeFtsIntegrity', () => {
    it('reads the trigger and the column by their exact names', async () => {
      const query = mockQuery({ hasTrigger: true, hasColumn: true });

      await expect(probeFtsIntegrity(query as unknown as FtsQuery)).resolves.toEqual({
        hasTrigger: true,
        hasColumn: true,
        missingLocales: [],
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('information_schema.triggers'),
        FTS_TRIGGER_NAME,
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('information_schema.columns'),
        FTS_COLUMN_NAME,
      );
    });
  });

  describe('ftsCheckApplies', () => {
    it('runs outside production and never inside it', () => {
      expect(ftsCheckApplies('development')).toBe(true);
      expect(ftsCheckApplies('test')).toBe(true);
      // Prod applies the SQL as the superuser through the pg container, so it
      // must not refuse to boot over a repair it cannot run itself. Every label
      // outside test and development is production, and so is no label.
      expect(ftsCheckApplies('production')).toBe(false);
      expect(ftsCheckApplies('staging')).toBe(false);
      expect(ftsCheckApplies(undefined)).toBe(false);
    });
  });

  describe('assertFtsIntegrity', () => {
    it('throws on the broken state so the API refuses to boot', async () => {
      const query = mockQuery({ hasTrigger: true, hasColumn: false });

      await expect(assertFtsIntegrity(query as unknown as FtsQuery, 'development')).rejects.toThrow(
        FTS_REPAIR_COMMAND,
      );
    });

    it('stays silent on the healthy state', async () => {
      const query = mockQuery({ hasTrigger: true, hasColumn: true });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await expect(
        assertFtsIntegrity(query as unknown as FtsQuery, 'development'),
      ).resolves.toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('does not probe at all in production', async () => {
      const query = mockQuery({ hasTrigger: true, hasColumn: false });

      await expect(
        assertFtsIntegrity(query as unknown as FtsQuery, 'production'),
      ).resolves.toBeUndefined();
      expect(query).not.toHaveBeenCalled();
    });

    it('does not turn an unreachable database into a boot failure', async () => {
      const query = jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      });

      await expect(
        assertFtsIntegrity(query as unknown as FtsQuery, 'development'),
      ).resolves.toBeUndefined();
    });
  });

  describe('registry locales', () => {
    it('reports a registry locale the applied trigger function does not index', () => {
      const verdict = evaluateFtsIntegrity({
        hasTrigger: true,
        hasColumn: true,
        missingLocales: ['de'],
      });

      expect(verdict.ok).toBe(true);
      expect(verdict.message).toContain('de');
      expect(verdict.message).toContain('npm run db:fts:generate');
      expect(verdict.message).toContain(FTS_REPAIR_COMMAND);
    });

    it('probe finds no missing locale when the function source covers the registry', async () => {
      const probe = await probeFtsIntegrity(
        mockQuery({ hasTrigger: true, hasColumn: true }) as unknown as FtsQuery,
      );

      expect(probe.missingLocales).toEqual([]);
    });

    it('canary: a newly registered locale is flagged until the SQL is regenerated', async () => {
      const restore = registerScratchLocale('zz', 'ltr');
      try {
        const probe = await probeFtsIntegrity(
          mockQuery({ hasTrigger: true, hasColumn: true }) as unknown as FtsQuery,
        );
        // The mocked source has a `simple` tags segment but no `zz` name segment.
        expect(probe.missingLocales).toEqual(['zz']);
      } finally {
        restore();
      }
    });

    it('warns on a stale function source and still boots', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const query = mockQuery({
        hasTrigger: true,
        hasColumn: true,
        functionSource: "to_tsvector('french', unaccent(COALESCE(NEW.name->>'fr','')))",
      });

      await expect(
        assertFtsIntegrity(query as unknown as FtsQuery, 'development'),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('en, ar'));
      warn.mockRestore();
    });
  });
});
