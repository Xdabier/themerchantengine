import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { REPO_ROOT } from './lib/repo';

/**
 * Asserts what ESLint actually applies to a file, not what the config appears
 * to say.
 *
 * This guard exists because phase O2 shipped an `overrides` block at the root
 * that never fired. ESLint resolves an extended config's override globs
 * relative to the *extending* config, so `files: ['apps/admin/**']` written in
 * the root `.eslintrc.js` resolves to `apps/admin/apps/admin/**` once
 * `apps/admin/.eslintrc.js` extends it, and matches nothing. The config read
 * correctly and enforced nothing, which is the failure mode every guard in
 * this directory exists to prevent.
 *
 * `eslint --print-config` is the only honest answer to "is this rule on".
 */
const GUARD = 'eslint-effective-config';

const ESLINT = join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

interface EffectiveConfig {
  rules: Record<string, [string, ...unknown[]]>;
}

/** One spawn per file, memoised: eslint costs a few seconds to boot and the
 * gate is meant to be fast. */
const configCache = new Map<string, EffectiveConfig>();

function printConfig(file: string): EffectiveConfig {
  const cached = configCache.get(file);
  if (cached) return cached;
  const result = spawnSync(process.execPath, [ESLINT, '--print-config', file], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`eslint --print-config ${file} failed:\n${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as EffectiveConfig;
  configCache.set(file, parsed);
  return parsed;
}

function selectorsOf(config: EffectiveConfig): string[] {
  const rule = config.rules['no-restricted-syntax'];
  if (!Array.isArray(rule) || rule[0] !== 'error') return [];
  return (rule.slice(1) as Array<{ selector: string }>).map((entry) => entry.selector);
}

/** One representative file per config scope. Every lane has its own
 * `.eslintrc.js`, so one file per lane is enough to prove the rule reaches it,
 * and each extra file is another eslint boot. */
const UI_LANE_FILES = [
  'apps/admin/src/main.ts',
  'apps/storefront/src/app/layout/header.component.ts',
  'libs/admin-ui/src/index.ts',
  'libs/admin-services/src/index.ts',
  'libs/admin-types/src/index.ts',
  'libs/storefront-services/src/index.ts',
  'libs/storefront-types/src/index.ts',
];

const API_FILE = 'apps/api/src/main.ts';

describe(GUARD, () => {
  it.each(UI_LANE_FILES)('%s has no-explicit-any as an error', (file) => {
    expect(printConfig(file).rules['@typescript-eslint/no-explicit-any']?.[0]).toBe('error');
  });

  it('the api lane keeps no-explicit-any at warn, because it carries 21 of them', () => {
    expect(printConfig(API_FILE).rules['@typescript-eslint/no-explicit-any']?.[0]).toBe('warn');
  });

  it.each([...UI_LANE_FILES, API_FILE])(
    '%s bans bypassSecurityTrust*, the retired asset helper and originalStoragePath',
    (file) => {
      const selectors = selectorsOf(printConfig(file));
      expect(selectors.some((s) => s.includes('bypassSecurityTrust'))).toBe(true);
      expect(selectors.some((s) => s.includes('getUrlsByIds'))).toBe(true);
      // The AV3 restriction has to survive on every lane outside the modules
      // that own the field. This is what the dead override would have removed.
      expect(selectors.some((s) => s.includes('originalStoragePath'))).toBe(true);
    },
  );

  it('drops the AV3 restriction for the modules that legitimately read it', () => {
    const selectors = selectorsOf(printConfig('apps/api/src/modules/assets/assets.service.ts'));
    expect(selectors.some((s) => s.includes('originalStoragePath'))).toBe(false);
  });

  it('canary: the reader reports an absent rule rather than assuming it is on', () => {
    const config = printConfig(API_FILE);
    expect(config.rules['no-such-rule-exists']).toBeUndefined();
    expect(selectorsOf({ rules: {} })).toEqual([]);
    expect(selectorsOf({ rules: { 'no-restricted-syntax': ['off'] } })).toEqual([]);
  });
});
