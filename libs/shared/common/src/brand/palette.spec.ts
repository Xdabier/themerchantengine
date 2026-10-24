import { loadStoreConfigFixture, STORE_CONFIG_FIXTURE_IDS } from '../store-config-fixtures';
import {
  BRAND_TOKEN_KEYS,
  contrastRatio,
  generatePalette,
  PaletteContrastError,
  type BrandBaseColors,
} from './palette';

/**
 * The generator is the only place a colour is invented for an install, so its
 * spec is the contrast proof itself: every pair the brand-tokens doc names is
 * measured here, under hostile inputs, not just under the three fixtures.
 *
 * The canary at the bottom is what makes the rest of the file trustworthy. It
 * measures a pair known to fail and asserts the measurement says so, which is
 * the only way to know the assertions above would go red if the generator
 * stopped adjusting.
 */

/** Which of two colours is the darker, for an assertion that reads as intent. */
const luminanceOrder = (a: string, b: string): 'darker' | 'lighter' =>
  contrastRatio(a, '#000000') < contrastRatio(b, '#000000') ? 'darker' : 'lighter';

const base = (
  primary: string,
  secondary: string | null = null,
  accent: string | null = null,
): BrandBaseColors => ({
  primary,
  secondary,
  accent,
});

/** Text pairs, as `agent_docs/storefront/brand-tokens.md` "Contrast proof" lists them. */
const TEXT_PAIRS: ReadonlyArray<readonly [text: string, ground: string]> = [
  ['--brand-text', '--brand-bg'],
  ['--brand-text', '--brand-surface'],
  ['--brand-text', '--brand-surface-elevated'],
  ['--brand-text-muted', '--brand-bg'],
  ['--brand-text-muted', '--brand-surface'],
  ['--brand-text-muted', '--brand-surface-elevated'],
  ['--brand-on-primary', '--brand-primary'],
  ['--brand-on-primary', '--brand-primary-hover'],
  ['--brand-on-primary', '--brand-primary-active'],
  ['--brand-on-accent', '--brand-accent'],
  ['--brand-success', '--brand-bg'],
  ['--brand-warning', '--brand-bg'],
  ['--brand-error', '--brand-bg'],
  ['--brand-info', '--brand-bg'],
  // A product card grounds on `--brand-surface` and renders the state colours
  // as text on it. Fitting them against the page alone left these pairs at
  // roughly 4.2:1 in every shipped fixture.
  ['--brand-success', '--brand-surface'],
  ['--brand-warning', '--brand-surface'],
  ['--brand-error', '--brand-surface'],
  ['--brand-info', '--brand-surface'],
  // The primary is a text colour too: links, breadcrumbs, tertiary labels, and
  // the header grounds on the surface while rendering its links in it.
  ['--brand-primary', '--brand-bg'],
  ['--brand-primary', '--brand-surface'],
  // A secondary or tertiary button keeps its resting label on its hover
  // ground. That pair was a stylesheet color-mix nothing measured, and a live
  // axe run found it at about 3.2:1 on the cart.
  ['--brand-primary', '--brand-surface-strong'],
  ['--brand-text-muted', '--brand-surface-strong'],
  // A toast or a badge grounds on a functional colour and puts a label on it.
  ['--brand-on-functional', '--brand-success'],
  ['--brand-on-functional', '--brand-warning'],
  ['--brand-on-functional', '--brand-error'],
  ['--brand-on-functional', '--brand-info'],
];

/**
 * Non-text pairs: a component boundary or ground carries the 3:1 floor of WCAG
 * 1.4.11. The accent is deliberately absent. It is a fill behind its own text,
 * not a boundary against the page, and a light accent (the demo fixture ships
 * an amber one) is a legitimate brand colour that would never clear 3:1 on a
 * near-white ground. Its floor is `--brand-on-accent`, in the table above.
 */
const UI_PAIRS: ReadonlyArray<readonly [subject: string, ground: string]> = [
  ['--brand-border-strong', '--brand-bg'],
  // A category chip and a variant selector ground on the surface and take this
  // as their boundary, which measured about 2.8:1 under every shipped fixture.
  ['--brand-border-strong', '--brand-surface'],
  // The resting boundary of every form control, on both grounds it sits on.
  ['--brand-border-interactive', '--brand-bg'],
  ['--brand-border-interactive', '--brand-surface'],
  ['--brand-focus-ring', '--brand-bg'],
];

describe('generatePalette', () => {
  describe('token completeness', () => {
    it('fills every declared token key for a one-colour input', () => {
      const palette = generatePalette(base('#1F4E79'));
      for (const key of BRAND_TOKEN_KEYS) {
        expect(palette.tokens[key]).toMatch(/^#[0-9a-f]{6}$/);
      }
    });

    it('returns no token the doc does not declare', () => {
      const palette = generatePalette(base('#1F4E79'));
      expect(Object.keys(palette.tokens).sort()).toEqual([...BRAND_TOKEN_KEYS].sort());
    });

    it('is deterministic across calls', () => {
      expect(generatePalette(base('#3A5BA0', '#D08C2E'))).toEqual(
        generatePalette(base('#3A5BA0', '#D08C2E')),
      );
    });
  });

  describe('contrast proof', () => {
    const inputs: ReadonlyArray<readonly [label: string, colors: BrandBaseColors]> = [
      ['near-black primary', base('#050608')],
      ['zero-saturation primary', base('#6b6b6b')],
      ['primary identical to accent', base('#1F6F8B', null, '#1F6F8B')],
      ['fully saturated primary', base('#ff0000')],
      ['three colours given', base('#1F6F8B', '#D08C2E', '#243447')],
    ];

    /** Every failing pair, named, so a red run says which one and by how much. */
    const failures = (tokens: Record<string, string>): string[] => [
      ...TEXT_PAIRS.filter(([t, g]) => contrastRatio(tokens[t], tokens[g]) < 4.5).map(
        ([t, g]) => `${t} on ${g}: ${contrastRatio(tokens[t], tokens[g]).toFixed(2)} < 4.5`,
      ),
      ...UI_PAIRS.filter(([s, g]) => contrastRatio(tokens[s], tokens[g]) < 3).map(
        ([s, g]) => `${s} on ${g}: ${contrastRatio(tokens[s], tokens[g]).toFixed(2)} < 3`,
      ),
    ];

    it.each(inputs)('%s: every pair clears its floor', (_label, colors) => {
      expect(failures(generatePalette(colors).tokens)).toEqual([]);
    });

    it.each(STORE_CONFIG_FIXTURE_IDS)('fixture %s: every pair clears its floor', (id) => {
      const baseColors = loadStoreConfigFixture(id).brand.baseColors;
      expect(failures(generatePalette(baseColors).tokens)).toEqual([]);
    });
  });

  describe('adjustments', () => {
    it('records the accent fallback when the operator gives neither accent nor secondary', () => {
      const { tokens, adjustments } = generatePalette(base('#1F4E79'));
      expect(tokens['--brand-accent']).toBe(tokens['--brand-primary']);
      expect(adjustments).toContainEqual(
        expect.objectContaining({ token: '--brand-accent', reason: 'no-accent-given' }),
      );
    });

    it('takes the accent from the secondary colour when no accent is given', () => {
      const { tokens, adjustments } = generatePalette(base('#1F4E79', '#8a5a00'));
      expect(tokens['--brand-accent']).toBe('#8a5a00');
      expect(adjustments).toContainEqual(
        expect.objectContaining({ token: '--brand-accent', reason: 'accent-from-secondary' }),
      );
    });

    it('names the pair and the measured ratio on every contrast move', () => {
      const { tokens, adjustments } = generatePalette(base('#1F4E79'));
      const moves = adjustments.filter((a) => a.reason === 'contrast');
      // A near-white page cannot carry every functional hue untouched, so a
      // palette with no move at all would mean the fitting never ran.
      expect(moves.length).toBeGreaterThan(0);
      for (const move of moves) {
        expect(move.from).not.toBe(move.to);
        expect(move.to).toBe(tokens[move.token]);
        expect(move.against).toBeDefined();
        expect(move.ratio).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('rejection', () => {
    it('refuses a near-white primary and names the failing pair', () => {
      expect(() => generatePalette(base('#fdfdfc'))).toThrow(PaletteContrastError);
      expect(() => generatePalette(base('#fdfdfc'))).toThrow(/--brand-primary on --brand-bg/);
    });

    it('keeps a light accent and darkens the text on it rather than refusing', () => {
      const { tokens } = generatePalette(base('#1F4E79', '#f2b441'));
      expect(tokens['--brand-accent']).toBe('#f2b441');
      expect(contrastRatio(tokens['--brand-on-accent'], '#f2b441')).toBeGreaterThanOrEqual(4.5);
      expect(luminanceOrder(tokens['--brand-on-accent'], '#f2b441')).toBe('darker');
    });

    it('rejects a malformed hex rather than emitting a broken token', () => {
      expect(() => generatePalette(base('not-a-colour'))).toThrow(/not-a-colour/);
    });
  });

  describe('contrastRatio', () => {
    it('measures the WCAG extremes', () => {
      expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
      expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    });

    it('is symmetric', () => {
      expect(contrastRatio('#1F4E79', '#ffffff')).toBeCloseTo(
        contrastRatio('#ffffff', '#1F4E79'),
        10,
      );
    });

    // Canary. If this pair ever measured as passing, every assertion above
    // would be vacuous, because they all rest on this one function.
    it('reports a known-failing pair as failing', () => {
      expect(contrastRatio('#f2b441', '#ffffff')).toBeLessThan(4.5);
    });
  });
});
