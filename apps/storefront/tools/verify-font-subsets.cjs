/**
 * Storefront font-subset verifier (S14.6).
 *
 * Walks `apps/storefront/public/fonts/` and asserts every face declared
 * in `apps/storefront/src/styles/global.css` ships as a woff2 under the
 * subset floor. The architecture doc declares "subsetted" without a
 * numeric byte budget; this script encodes the floor as
 *
 *   Non-Latin family woff2  <= 60 KB
 *   Latin family woff2      <= 40 KB
 *
 * derived from typical Google-Fonts subset emissions. Full-face woff2
 * files are 100 to 300 KB, so any file above the floor is the unsliced
 * face and the script fails the run with a per-face table on breach.
 *
 * Required faces and weights, matching the `@font-face` declarations, for
 * both allowlisted kits (`REQUIRED_FACES` below is the list this prose
 * describes; keep the two in step):
 *   - `latin-rounded`: Baloo 2 500/600/700, Inter 400/500/600
 *   - `arabic-latin`: Cairo 800, Tajawal 400/500/700, plus Inter above
 *   - both kits: JetBrains Mono 400/500
 *
 * Both kits ship in every build and the runtime config selects one, so both
 * are budgeted here. The two-tier cap exists because an Arabic face carries a
 * larger glyph set than a Latin one at the same coverage.
 *
 * Exposed as `verifyFontSubsets({ fontDir, faces, arabicCapBytes,
 * latinCapBytes })` so the Vitest spec at
 * `apps/storefront/src/tools/verify-font-subsets.spec.ts` can drive it
 * with fixture inputs.
 */

const fs = require('node:fs');
const path = require('node:path');

const fontkit = require('fontkit');

const ARABIC_CAP_BYTES = 60 * 1024;
const LATIN_CAP_BYTES = 40 * 1024;

const ARABIC_FAMILIES = new Set(['cairo', 'tajawal']);

/**
 * Every face of every allowlisted kit. Both kits ship in one build and the
 * runtime config selects one, so both are budgeted and both are checked.
 *
 * `codepoints` overrides the default requirement for a face that is not
 * expected to carry it. Cairo is an Arabic display face and carries no Latin
 * at all; Tajawal carries Latin letters but not the U+2000-206F punctuation
 * block, which is why the `arabic-latin` kit lists Inter after it as the body
 * family: CSS falls back per glyph, so a price separator still finds a face.
 */
const ARABIC_ALEF = 0x0627;

const REQUIRED_FACES = [
  { family: 'baloo2', weights: [500, 600, 700] },
  { family: 'inter', weights: [400, 500, 600] },
  { family: 'jetbrains-mono', weights: [400, 500] },
  { family: 'cairo', weights: [800], codepoints: [ARABIC_ALEF] },
  { family: 'tajawal', weights: [400, 500, 700], codepoints: [ARABIC_ALEF, 0x00a0] },
];

/**
 * @param {object} opts
 * @param {string} opts.fontDir — absolute path to the fonts dir
 * @param {Array<{family: string, weights: number[]}>} [opts.faces] — required faces
 * @param {number} [opts.arabicCapBytes]
 * @param {number} [opts.latinCapBytes]
 * @returns {{ ok: boolean, table: Array<{file: string, family: string, weight: number, bytes: number, cap: number, status: 'ok' | 'over' | 'missing'}> }}
 */
function verifyFontSubsets({
  fontDir,
  faces = REQUIRED_FACES,
  arabicCapBytes = ARABIC_CAP_BYTES,
  latinCapBytes = LATIN_CAP_BYTES,
}) {
  if (!fs.existsSync(fontDir)) {
    const err = new Error(`Font dir not found at ${fontDir}`);
    err.code = 'FONT_DIR_MISSING';
    throw err;
  }

  const table = [];
  for (const face of faces) {
    const cap = ARABIC_FAMILIES.has(face.family) ? arabicCapBytes : latinCapBytes;
    for (const weight of face.weights) {
      const file = `${face.family}-${weight}.woff2`;
      const fullPath = path.join(fontDir, file);
      if (!fs.existsSync(fullPath)) {
        table.push({ file, family: face.family, weight, bytes: 0, cap, status: 'missing' });
        continue;
      }
      const bytes = fs.statSync(fullPath).size;
      table.push({
        file,
        family: face.family,
        weight,
        bytes,
        cap,
        status: bytes > cap ? 'over' : 'ok',
      });
    }
  }

  const ok = table.every((row) => row.status === 'ok');
  return { ok, table };
}

/**
 * Codepoints every shipped face must actually carry a glyph for.
 *
 * U+202F, the narrow no-break space, is the thousands separator brand-floor
 * §3.2 mandates for the price format, and `lib/money.ts` puts it in every
 * price the storefront renders. Google's `latin` subset declares
 * `U+2000-206F` in its `unicode-range` but ships no glyph for U+202F in Baloo
 * 2, Inter, or JetBrains Mono, so the faces are patched by
 * `tools/patch-narrow-nbsp.py`. Declaring the range is not evidence the glyph
 * is there, which is the whole reason this check exists separately from the
 * `@font-face` assertion in `styles/brand-tokens.spec.ts`: re-downloading a
 * face from upstream would silently break the separator in every price on the
 * site and nothing else would notice.
 *
 * U+00A0 is the no-break space the same format puts before the currency
 * symbol. U+00E9 stands for the accented set French needs.
 */
const REQUIRED_CODEPOINTS = [0x202f, 0x00a0, 0x00e9];

/**
 * @param {object} opts
 * @param {string} opts.fontDir — absolute path to the fonts dir
 * @param {Array<{family: string, weights: number[]}>} [opts.faces]
 * @param {number[]} [opts.codepoints] — overrides every face's own requirement
 * @returns {{ ok: boolean, table: Array<{file: string, missing: number[], status: 'ok' | 'missing-glyph' | 'unreadable' | 'missing'}> }}
 */
function verifyFontCodepoints({ fontDir, faces = REQUIRED_FACES, codepoints }) {
  if (!fs.existsSync(fontDir)) {
    const err = new Error(`Font dir not found at ${fontDir}`);
    err.code = 'FONT_DIR_MISSING';
    throw err;
  }

  const table = [];
  for (const face of faces) {
    // An explicit caller argument wins over the face's own requirement, so a
    // caller can ask "does every shipped face carry this codepoint" and get an
    // answer about every face rather than about the Latin ones only.
    const required = codepoints ?? face.codepoints ?? REQUIRED_CODEPOINTS;
    for (const weight of face.weights) {
      const file = `${face.family}-${weight}.woff2`;
      const fullPath = path.join(fontDir, file);
      if (!fs.existsSync(fullPath)) {
        table.push({ file, missing: required.slice(), status: 'missing' });
        continue;
      }
      let font;
      try {
        font = fontkit.openSync(fullPath);
      } catch {
        table.push({ file, missing: required.slice(), status: 'unreadable' });
        continue;
      }
      const missing = required.filter((cp) => !font.hasGlyphForCodePoint(cp));
      table.push({ file, missing, status: missing.length ? 'missing-glyph' : 'ok' });
    }
  }

  return { ok: table.every((row) => row.status === 'ok'), table };
}

function formatCodepoint(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function main() {
  const workspaceRoot = path.resolve(__dirname, '..', '..', '..');
  const fontDir = path.join(workspaceRoot, 'apps', 'storefront', 'public', 'fonts');
  let result;
  try {
    result = verifyFontSubsets({ fontDir });
  } catch (err) {
    if (err && err.code === 'FONT_DIR_MISSING') {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  process.stdout.write('Storefront font-subset report\n');
  process.stdout.write('-----------------------------\n');
  for (const row of result.table) {
    const flag = row.status === 'ok' ? 'ok' : row.status.toUpperCase();
    process.stdout.write(
      `${row.file.padEnd(28)} ${formatBytes(row.bytes).padStart(10)} / ${formatBytes(row.cap)} ${flag}\n`,
    );
  }
  const coverage = verifyFontCodepoints({ fontDir });
  process.stdout.write('\nRequired-codepoint report\n');
  process.stdout.write('-------------------------\n');
  for (const row of coverage.table) {
    const detail = row.missing.length ? row.missing.map(formatCodepoint).join(', ') : '-';
    process.stdout.write(`${row.file.padEnd(28)} ${row.status.padEnd(14)} missing: ${detail}\n`);
  }

  if (!result.ok) {
    process.stderr.write('\nFont-subset breach — see table above.\n');
    process.exit(1);
  }
  if (!coverage.ok) {
    process.stderr.write(
      '\nRequired-codepoint breach — see table above. Run tools/patch-narrow-nbsp.py.\n',
    );
    process.exit(1);
  }
  process.stdout.write('\nAll font subsets within budget, all required codepoints present.\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  verifyFontSubsets,
  verifyFontCodepoints,
  REQUIRED_CODEPOINTS,
  ARABIC_CAP_BYTES,
  LATIN_CAP_BYTES,
  REQUIRED_FACES,
};
