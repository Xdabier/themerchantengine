/**
 * Vitest spec for tools/verify-font-subsets.cjs (S14.6).
 *
 * Drives the font-subset verifier against a fixture font dir per test.
 * The real `apps/storefront/public/fonts/` is exercised by the e2e gate
 * at S14.12 via the `nx run storefront:verify-font-subsets` target.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  verifyFontSubsets,
  verifyFontCodepoints,
  ARABIC_CAP_BYTES,
  LATIN_CAP_BYTES,
  REQUIRED_FACES,
  REQUIRED_CODEPOINTS,
  // @ts-expect-error — CJS module without .d.ts; runtime contract verified via the assertions below.
} from '../../tools/verify-font-subsets.cjs';

function writeFixtureFonts(fontDir: string, files: Record<string, number>) {
  fs.mkdirSync(fontDir, { recursive: true });
  for (const [name, size] of Object.entries(files)) {
    fs.writeFileSync(path.join(fontDir, name), Buffer.alloc(size));
  }
}

describe('verifyFontSubsets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storefront-font-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exposes the documented subset thresholds + required-face roster', () => {
    expect(ARABIC_CAP_BYTES).toBe(60 * 1024);
    expect(LATIN_CAP_BYTES).toBe(40 * 1024);
    expect(REQUIRED_FACES).toEqual([
      { family: 'baloo2', weights: [500, 600, 700] },
      { family: 'inter', weights: [400, 500, 600] },
      { family: 'jetbrains-mono', weights: [400, 500] },
      // The Arabic-capable kit. Its faces carry their own codepoint
      // requirement: Cairo is Arabic-only display, and Tajawal carries Latin
      // letters but not the punctuation block a grouped price uses.
      { family: 'cairo', weights: [800], codepoints: [0x0627] },
      { family: 'tajawal', weights: [400, 500, 700], codepoints: [0x0627, 0x00a0] },
    ]);
  });

  it('returns ok=true when every face fits the family cap', () => {
    writeFixtureFonts(tmpDir, {
      'inter-400.woff2': 24_000,
      'inter-500.woff2': 24_000,
      'inter-600.woff2': 25_000,
      'baloo2-500.woff2': 20_000,
      'baloo2-600.woff2': 20_000,
      'baloo2-700.woff2': 20_000,
      'jetbrains-mono-400.woff2': 22_000,
      'jetbrains-mono-500.woff2': 22_000,
      'cairo-800.woff2': 14_000,
      'tajawal-400.woff2': 9_000,
      'tajawal-500.woff2': 9_000,
      'tajawal-700.woff2': 9_000,
    });
    const { ok, table } = verifyFontSubsets({ fontDir: tmpDir });
    expect(ok).toBe(true);
    expect(table.length).toBe(12);
    expect(table.every((r: { status: string }) => r.status === 'ok')).toBe(true);
  });

  it('flags a non-Latin face above the 60 KB cap as OVER', () => {
    writeFixtureFonts(tmpDir, {
      'cairo-800.woff2': 80_000,
    });
    const { ok, table } = verifyFontSubsets({
      fontDir: tmpDir,
      faces: [{ family: 'cairo', weights: [800] }],
    });
    expect(ok).toBe(false);
    const cairo = table.find((r: { file: string }) => r.file === 'cairo-800.woff2');
    expect(cairo?.status).toBe('over');
    expect(cairo?.cap).toBe(ARABIC_CAP_BYTES);
  });

  it('flags a Latin face above the 40 KB cap as OVER', () => {
    writeFixtureFonts(tmpDir, {
      'inter-400.woff2': 60_000,
      'inter-500.woff2': 24_000,
      'inter-600.woff2': 25_000,
      'baloo2-500.woff2': 20_000,
      'baloo2-600.woff2': 20_000,
      'baloo2-700.woff2': 20_000,
      'jetbrains-mono-400.woff2': 22_000,
      'jetbrains-mono-500.woff2': 22_000,
      'cairo-800.woff2': 14_000,
      'tajawal-400.woff2': 9_000,
      'tajawal-500.woff2': 9_000,
      'tajawal-700.woff2': 9_000,
    });
    const { ok, table } = verifyFontSubsets({ fontDir: tmpDir });
    expect(ok).toBe(false);
    const inter = table.find((r: { file: string }) => r.file === 'inter-400.woff2');
    expect(inter?.status).toBe('over');
    expect(inter?.cap).toBe(LATIN_CAP_BYTES);
  });

  it('flags a missing face as MISSING', () => {
    writeFixtureFonts(tmpDir, {
      // inter-500 deliberately absent
      'inter-400.woff2': 24_000,
      'inter-600.woff2': 25_000,
      'baloo2-500.woff2': 20_000,
      'baloo2-600.woff2': 20_000,
      'baloo2-700.woff2': 20_000,
      'jetbrains-mono-400.woff2': 22_000,
      'jetbrains-mono-500.woff2': 22_000,
      'cairo-800.woff2': 14_000,
      'tajawal-400.woff2': 9_000,
      'tajawal-500.woff2': 9_000,
      'tajawal-700.woff2': 9_000,
    });
    const { ok, table } = verifyFontSubsets({ fontDir: tmpDir });
    expect(ok).toBe(false);
    const inter500 = table.find((r: { file: string }) => r.file === 'inter-500.woff2');
    expect(inter500?.status).toBe('missing');
    expect(inter500?.bytes).toBe(0);
  });

  it('throws FONT_DIR_MISSING when the dir is absent', () => {
    expect(() => verifyFontSubsets({ fontDir: path.join(tmpDir, 'nope') })).toThrow(
      /font dir not found/i,
    );
  });

  it('respects custom non-Latin + Latin caps passed by the caller', () => {
    writeFixtureFonts(tmpDir, {
      'inter-400.woff2': 24_000,
      'inter-500.woff2': 24_000,
      'inter-600.woff2': 25_000,
      'baloo2-500.woff2': 20_000,
      'baloo2-600.woff2': 20_000,
      'baloo2-700.woff2': 20_000,
      'jetbrains-mono-400.woff2': 22_000,
      'jetbrains-mono-500.woff2': 22_000,
      'cairo-800.woff2': 14_000,
      'tajawal-400.woff2': 9_000,
      'tajawal-500.woff2': 9_000,
      'tajawal-700.woff2': 9_000,
    });
    // Tighten both caps below current sizes, so every face flips to OVER.
    const { ok, table } = verifyFontSubsets({
      fontDir: tmpDir,
      faces: REQUIRED_FACES,
      arabicCapBytes: 5_000,
      latinCapBytes: 5_000,
    });
    expect(ok).toBe(false);
    expect(table.every((r: { status: string }) => r.status === 'over')).toBe(true);
    const cairo = table.find((r: { file: string }) => r.file === 'cairo-800.woff2');
    expect(cairo?.cap).toBe(5_000);
  });

  it('runs cleanly against the real shipped fonts in apps/storefront/public/fonts', () => {
    const realDir = path.resolve(__dirname, '..', '..', 'public', 'fonts');
    const { ok, table } = verifyFontSubsets({ fontDir: realDir });
    if (!ok) {
      const breach = table.filter((r: { status: string }) => r.status !== 'ok');
      throw new Error(
        `Real font dir is over budget — ${breach.map((r: { file: string; bytes: number; status: string }) => `${r.file}=${r.bytes}b/${r.status}`).join(', ')}`,
      );
    }
    expect(ok).toBe(true);
  });
});

describe('verifyFontCodepoints', () => {
  // This block deliberately runs against the REAL font directory rather than a
  // fixture. The thing being guarded is the content of eight committed binaries,
  // so a synthetic fixture would prove nothing about what actually ships.
  const REAL_FONT_DIR = path.resolve(__dirname, '..', '..', 'public', 'fonts');

  it('requires the narrow no-break space, the no-break space, and the accented set', () => {
    expect(REQUIRED_CODEPOINTS).toEqual([0x202f, 0x00a0, 0x00e9]);
  });

  it('finds every required codepoint in every shipped face', () => {
    const { ok, table } = verifyFontCodepoints({ fontDir: REAL_FONT_DIR });
    const broken = table.filter((row: { status: string }) => row.status !== 'ok');
    // U+202F is the thousands separator agent_docs/storefront/brand-tokens.md mandates, and
    // lib/money.ts puts it in every price. Google's latin subset declares the
    // range in its unicode-range but ships no glyph, so the faces are patched
    // by tools/patch-narrow-nbsp.py. If this fails after a font is refreshed
    // from upstream, re-run that script rather than widening this test.
    expect(broken, JSON.stringify(broken, null, 2)).toEqual([]);
    expect(ok).toBe(true);
    expect(table.length).toBe(12);
  });

  it('reports a face that is present but missing a glyph', () => {
    // Scoped to the Latin kit: since the Arabic kit ships, a codepoint "no
    // face carries" no longer exists, and Cairo and Tajawal answer this one.
    const { table } = verifyFontCodepoints({
      fontDir: REAL_FONT_DIR,
      faces: [
        { family: 'baloo2', weights: [500] },
        { family: 'inter', weights: [400] },
      ],
      // Arabic meem, which no Latin subset carries.
      codepoints: [0x0645],
    });
    expect(table.every((row: { status: string }) => row.status === 'missing-glyph')).toBe(true);
    expect(table[0].missing).toEqual([0x0645]);
  });

  it('finds the Arabic block in the faces of the Arabic-capable kit', () => {
    const { ok } = verifyFontCodepoints({
      fontDir: REAL_FONT_DIR,
      faces: [
        { family: 'cairo', weights: [800] },
        { family: 'tajawal', weights: [400, 500, 700] },
      ],
      codepoints: [0x0645, 0x0627],
    });
    expect(ok).toBe(true);
  });

  it('reports an absent file as missing rather than throwing', () => {
    const { ok, table } = verifyFontCodepoints({
      fontDir: REAL_FONT_DIR,
      faces: [{ family: 'nunito', weights: [800] }],
    });
    expect(ok).toBe(false);
    expect(table[0]).toMatchObject({ file: 'nunito-800.woff2', status: 'missing' });
  });

  it('throws FONT_DIR_MISSING when the directory does not exist', () => {
    expect(() => verifyFontCodepoints({ fontDir: path.join(REAL_FONT_DIR, 'nope') })).toThrow(
      /Font dir not found/,
    );
  });
});
