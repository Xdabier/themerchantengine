import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ENGINE_FINGERPRINT_GLOBAL,
  ENGINE_FINGERPRINT_NAME,
  ENGINE_VERSION,
  engineFingerprintValue,
  exposeEngineFingerprint,
  isEngineFingerprintEnabled,
} from './engine-fingerprint';

describe('engineFingerprintValue', () => {
  it('emits the name only by default', () => {
    expect(engineFingerprintValue({})).toBe('themerchantengine');
  });

  it('adds the major version and never the full one when asked', () => {
    const value = engineFingerprintValue({ TME_FINGERPRINT_VERSION: 'major' });
    expect(value).toBe(`themerchantengine ${ENGINE_VERSION.split('.')[0]}`);
    expect(value).not.toContain(ENGINE_VERSION);
  });

  it.each([['full'], ['1.0.0'], ['']])('ignores TME_FINGERPRINT_VERSION=%s', (mode) => {
    expect(engineFingerprintValue({ TME_FINGERPRINT_VERSION: mode })).toBe(ENGINE_FINGERPRINT_NAME);
  });

  it.each([['off'], ['OFF'], [' false '], ['0'], ['no']])(
    'is null for TME_FINGERPRINT=%s',
    (flag) => {
      expect(engineFingerprintValue({ TME_FINGERPRINT: flag })).toBeNull();
      expect(isEngineFingerprintEnabled({ TME_FINGERPRINT: flag })).toBe(false);
    },
  );

  it.each([['on'], ['true'], [''], [undefined]])('stays on for TME_FINGERPRINT=%s', (flag) => {
    expect(isEngineFingerprintEnabled({ TME_FINGERPRINT: flag })).toBe(true);
  });
});

describe('ENGINE_VERSION', () => {
  it('matches the root package.json version', () => {
    const pkgPath = path.resolve(__dirname, '../../../../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});

describe('exposeEngineFingerprint', () => {
  const docWith = (hasMeta: boolean) => ({
    querySelector: (selector: string) =>
      hasMeta && selector.includes('generator') && selector.includes(ENGINE_FINGERPRINT_NAME)
        ? {}
        : null,
  });

  it('sets the global when the generator meta is present', () => {
    const win: Record<string, unknown> = {};
    exposeEngineFingerprint(docWith(true), win, 'admin');
    expect(win[ENGINE_FINGERPRINT_GLOBAL]).toEqual({ app: 'admin' });
  });

  it('leaves the global unset when the meta was stripped', () => {
    const win: Record<string, unknown> = {};
    exposeEngineFingerprint(docWith(false), win, 'storefront');
    expect(ENGINE_FINGERPRINT_GLOBAL in win).toBe(false);
  });
});
