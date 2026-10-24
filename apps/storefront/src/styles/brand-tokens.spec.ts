import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BRAND_TOKEN_KEYS, contrastRatio, generatePalette } from '@common/brand';
import { NEUTRAL_STORE_CONFIG } from '@common/store-config';
import {
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
  STORE_CONFIG_FIXTURE_IDS,
} from '@common/store-config-fixtures';

import { FONT_KITS } from '../app/services/brand-tokens.service';

/**
 * Token-layer contract for the engine (DR-31, plan E2.2).
 *
 * There is no client brand floor to assert against any more. The palette is
 * generated per install from the operator's base colours and injected at SSR,
 * so what this file pins is the *shape* of the layer, not one store's values:
 *
 *   - `brand.css` declares the whole generated token set as a fallback, and
 *     those fallback values are the generator's own output for the neutral
 *     config, so the file cannot drift from the function.
 *   - Everything outside `brand.css` consumes tokens and states no colour.
 *   - Both font kits ship, and every face covers the codepoints a rendered
 *     price and an Arabic page need.
 *
 * The sweep is the part that catches regressions: it walks the storefront
 * source tree and fails on a raw hex, a raw `rgba(...)`, or a consumer of a
 * token nothing declares.
 */

const STOREFRONT = path.resolve(__dirname, '..', '..');
const SRC = path.join(STOREFRONT, 'src');
const BRAND_CSS = path.join(SRC, 'styles', 'brand.css');
const GLOBAL_CSS = path.join(SRC, 'styles', 'global.css');

const brandCss = () => fs.readFileSync(BRAND_CSS, 'utf8');
const globalCss = () => fs.readFileSync(GLOBAL_CSS, 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|html|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Every storefront source file except the token layer and the specs. All are
 * excluded for the same reason: they name colours by value on purpose, one as
 * the token layer and the rest as the guards that police it. None ships CSS.
 */
function sourceFiles(): { file: string; text: string }[] {
  const excluded = [BRAND_CSS].map((f) => path.normalize(f));
  return walk(SRC)
    .filter((f) => !excluded.includes(path.normalize(f)))
    .filter((f) => !f.endsWith('.spec.ts'))
    .map((f) => ({ file: path.relative(STOREFRONT, f), text: fs.readFileSync(f, 'utf8') }));
}

/** Reads a single custom-property declaration out of brand.css. */
function token(name: string): string | null {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(brandCss());
  return m ? m[1].trim() : null;
}

const NEUTRAL_PALETTE = generatePalette(NEUTRAL_STORE_CONFIG.brand.baseColors);

/** A focus outline drawn from the brand colour rather than the focus token. */
const OUTLINE_ON_PRIMARY = /outline:[^;\n]*var\(--brand-primary\)/;

describe('brand.css fallback palette', () => {
  it('declares every token the generator produces', () => {
    for (const key of BRAND_TOKEN_KEYS) {
      expect(token(key), `${key} missing from brand.css`).not.toBeNull();
    }
  });

  it('declares them at exactly the generator output for the neutral config', () => {
    // The one assertion that keeps a hand-edited stylesheet from disagreeing
    // with the function that produces the real thing at runtime.
    const declared = Object.fromEntries(BRAND_TOKEN_KEYS.map((k) => [k, token(k)]));
    expect(declared).toEqual(NEUTRAL_PALETTE.tokens);
  });

  it('states no colour outside the fallback block', () => {
    // Everything below the fallback is a role derived from it. A literal there
    // would be a colour that ignores the install's palette.
    // From the section marker inside the `:root` block, not the one in the
    // file header, which is prose describing it.
    const css = brandCss();
    const derived = css.slice(css.indexOf('§2 Derived colours', css.indexOf(':root {')));
    expect(derived).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(derived).not.toMatch(/\brgba?\(/);
  });

  it('derives every extra colour role from a generated token', () => {
    for (const name of [
      '--brand-success-text',
      '--brand-warning-text',
      '--brand-error-hover',
      '--brand-scrim-modal',
      '--brand-hover-overlay',
      '--brand-overlay-bg',
      '--brand-on-primary-hover-bg',
      '--brand-on-primary-divider',
      '--brand-focus',
      '--brand-primary-dark',
      '--brand-primary-pressed',
    ]) {
      expect(token(name), `${name} missing`).toMatch(/var\(--brand-/);
    }
  });

  it('casts every shadow off the text colour, so elevation follows the palette', () => {
    for (const name of [
      '--brand-shadow-xs',
      '--brand-shadow-md',
      '--brand-shadow-card',
      '--brand-shadow-dialog',
      '--brand-shadow-drawer',
      '--brand-shadow-toast',
    ]) {
      expect(token(name), `${name} missing`).toContain('var(--brand-shadow-color');
    }
    expect(token('--brand-shadow-color')).toContain('var(--brand-text)');
  });
});

describe('brand.css structure', () => {
  it('names no font family directly, so the kit token selects one', () => {
    expect(token('--brand-font-display')).toContain('var(--brand-kit-display)');
    expect(token('--brand-font-body')).toContain('var(--brand-kit-body)');
  });

  it('states the default kit at exactly the values the kit map holds', () => {
    // The palette half of the fallback is pinned against the generator; this
    // is the same guarantee for the font half, which was two copies of the
    // families and the scale with nothing holding them together.
    const kit = FONT_KITS['latin-rounded'];
    expect(token('--brand-kit-display')).toBe(kit.display);
    expect(token('--brand-kit-body')).toBe(kit.body);
    expect(token('--brand-text-display')).toBe(kit.scale.display);
    expect(token('--brand-text-display-mobile')).toBe(kit.scale.displayMobile);
    expect(token('--brand-text-section')).toBe(kit.scale.section);
    expect(token('--brand-text-product')).toBe(kit.scale.product);
    expect(token('--brand-text-price')).toBe(kit.scale.price);
    expect(token('--brand-text-body')).toBe(kit.scale.body);
    expect(token('--brand-text-secondary')).toBe(kit.scale.secondary);
    expect(token('--brand-text-micro')).toBe(kit.scale.micro);
  });

  it('keeps the four-step radius scale and the motion pair', () => {
    expect(token('--brand-radius-sm')).toBe('4px');
    expect(token('--brand-radius-full')).toBe('9999px');
    expect(token('--brand-motion-duration')).toBe('175ms');
    expect(token('--brand-motion-easing')).not.toBeNull();
  });
});

/** The family names inside a CSS font stack, in fallback order. */
function familiesOf(stack: string): string[] {
  return [...stack.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('global.css font kits', () => {
  it('ships the faces of both allowlisted kits', () => {
    const css = globalCss();
    const declared = new Set(
      Object.values(FONT_KITS).flatMap((kit) => familiesOf(`${kit.display}, ${kit.body}`)),
    );
    // `JetBrains Mono` belongs to no kit: it is the fixed mono face.
    for (const family of [...declared, 'JetBrains Mono']) {
      expect(css, `${family} face missing`).toContain(`font-family: '${family}'`);
    }
  });

  it('gives every kit a face covering U+202F, through its own fallback chain', () => {
    // The narrow no-break space is a group separator two of the three scenario
    // fixtures use, and a face that excluded it would drop out mid-number.
    //
    // Asserted per kit rather than per face, because that is the real rule:
    // Tajawal carries no U+2000-206F block, and the `arabic-latin` kit is
    // correct anyway because it lists Inter after it and CSS falls back per
    // glyph. The earlier form allowed any face to pass by naming the Arabic
    // range, so it could not fail for the case its own title described.
    const css = globalCss();
    const rangeFor = (family: string): string => {
      const at = css.indexOf(`font-family: '${family}'`);
      const m = /unicode-range:\s*([^;]+);/.exec(css.slice(at));
      return (m?.[1] ?? '').replace(/\s+/g, '');
    };
    const covers202f = (family: string): boolean => rangeFor(family).includes('U+2000-206F');

    // Read out of the kit definitions rather than copied beside them, so a new
    // kit is covered the moment it is declared.
    for (const [kit, def] of Object.entries(FONT_KITS)) {
      const families = familiesOf(`${def.display}, ${def.body}`);
      expect(families.length, `${kit} declares no family`).toBeGreaterThan(0);
      expect(families.some(covers202f), `${kit} has no face covering U+202F`).toBe(true);
    }
    // The specific fallback that makes the Arabic kit work.
    expect(covers202f('Tajawal')).toBe(false);
    expect(covers202f('Inter')).toBe(true);
  });

  it('covers the Arabic block on the faces of the Arabic-capable kit', () => {
    const css = globalCss();
    for (const family of ['Cairo', 'Tajawal']) {
      const block = css.slice(css.indexOf(`font-family: '${family}'`));
      expect(block.slice(0, 400), `${family} misses the Arabic range`).toContain('U+0600-06FF');
    }
  });
});

describe('the default brand marks', () => {
  const markDir = path.join(STOREFRONT, 'public', 'brand', 'default');
  const mark = (file: string) => fs.readFileSync(path.join(markDir, file), 'utf8');

  it('ships one mark per ground, each stating its own ink', () => {
    // Loaded through an `<img>`, so the SVG renders in its own document and
    // `currentColor` resolves to that document's black rather than to the
    // colour around it. A single currentColor mark was invisible on the dark
    // footer, which no `src` assertion could have caught.
    for (const file of ['logo.svg', 'logo-inverse.svg']) {
      expect(mark(file), `${file} leaves its ink to currentColor`).not.toContain('currentColor');
    }
  });

  it('inks each mark for the ground it is used on', () => {
    const palette = NEUTRAL_PALETTE.tokens;
    // The header grounds on the page, the footer on the text colour.
    expect(mark('logo.svg')).toContain(palette['--brand-text']);
    expect(mark('logo-inverse.svg')).toContain(palette['--brand-text-inverse']);
  });

  it('gives each mark enough contrast against its own ground to read', () => {
    const inkOf = (file: string): string => {
      const m = /<text[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(mark(file));
      if (!m) throw new Error(`${file} has no inked wordmark`);
      return m[1];
    };

    // These marks ship with every install and stay until the operator replaces
    // them, so the neutral palette alone proves nothing: the grounds they sit
    // on are whatever the operator's base colours generate. Every scenario
    // fixture has to read.
    const palettes: [string, Record<string, string>][] = [
      ['neutral', NEUTRAL_PALETTE.tokens],
      ...STORE_CONFIG_FIXTURE_IDS.map(
        (id) =>
          [
            id,
            generatePalette(runtimeConfigOfFixture(loadStoreConfigFixture(id)).brand.baseColors)
              .tokens,
          ] as [string, Record<string, string>],
      ),
    ];
    for (const [name, palette] of palettes) {
      // The wordmark is an image of text, so WCAG 1.4.3 applies to it.
      expect(
        contrastRatio(inkOf('logo.svg'), palette['--brand-bg']),
        `logo.svg on the ${name} page ground`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(inkOf('logo-inverse.svg'), palette['--brand-text']),
        `logo-inverse.svg on the ${name} footer ground`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('storefront sweep', () => {
  it('has no raw hex literal outside brand.css', () => {
    const offenders = sourceFiles()
      .filter(({ text }) => /(?:^|[^&\w])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/m.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('has no raw rgba() at a call site', () => {
    const offenders = sourceFiles()
      .filter(({ text }) => /\brgba?\(\s*\d/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('draws every focus ring from the focus token, not the primary', () => {
    // The generator fits `--brand-focus-ring` for the 3:1 focus floor. While
    // every `:focus-visible` rule named `--brand-primary` instead, the two
    // happened to be equal and nothing enforced that they stay equal.
    const offenders = sourceFiles()
      .filter(({ text }) => OUTLINE_ON_PRIMARY.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
    const users = sourceFiles().filter(({ text }) => text.includes('var(--brand-focus)'));
    expect(users.length).toBeGreaterThan(0);
  });

  it('has no consumer of a token nothing declares', () => {
    // The failure this catches is a rename: a token disappears from the layer
    // and every `var()` reading it silently resolves to nothing.
    const declared = new Set(
      [...brandCss().matchAll(/^\s*(--brand-[a-z0-9-]+):/gm)].map((m) => m[1]),
    );
    // The injected block declares these two; brand.css declares them as well,
    // so this only needs the generated set to be present.
    const consumed = new Set(
      sourceFiles().flatMap(({ text }) =>
        [...text.matchAll(/var\((--brand-[a-z0-9-]+)/g)].map((m) => m[1]),
      ),
    );
    const undeclared = [...consumed].filter((t) => !declared.has(t)).sort();
    expect(undeclared).toEqual([]);
  });
});

describe('the palettes this epic deleted stay deleted', () => {
  it('tailwind.config.js declares no colour, size, or family', () => {
    const config = fs.readFileSync(path.join(STOREFRONT, 'tailwind.config.js'), 'utf8');
    expect(config).not.toMatch(/colors\s*:/);
    expect(config).not.toMatch(/fontFamily\s*:/);
    expect(config).not.toMatch(/fontSize\s*:/);
  });

  it('sitemap.xsl carries no brand token and no hex', () => {
    const file = path.join(STOREFRONT, 'public', 'sitemap.xsl');
    const xsl = fs.readFileSync(file, 'utf8');
    expect(xsl).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(xsl).not.toContain('--brand-');
  });
});
