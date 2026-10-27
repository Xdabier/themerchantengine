/**
 * The brand palette generator (DR-31, plan E2.1).
 *
 * One to three base colours, entered once in the install stepper or the admin
 * brand screen, expand here into the whole token set the storefront renders
 * (`agent_docs/storefront/brand-tokens.md` "Token categories"). It is a pure
 * function with no dependency and no I/O, because three callers need the same
 * answer from the same input: the API composes it into `GET /v1/store/config`,
 * the CLI previews it in a terminal before anything is written, and the admin
 * brand screen shows the contrast report next to the colour pickers.
 *
 * Two rules shape everything below.
 *
 * A derived colour moves before a brand colour does. Text, surfaces, borders
 * and the functional hues are all fitted against whatever they sit on, so most
 * palettes never touch what the operator entered.
 *
 * When no derived move rescues a pair, the brand colour itself may move, but
 * only within `MAX_SEED_SHIFT` of lightness and only with the move recorded in
 * `adjustments`. A saturated mid-tone red is the case that needs it: neither
 * black nor white reaches AA on it, so the button ground has to give a little
 * or the label is unreadable. Past that bound the palette is rejected with the
 * failing pair named, which is what a near-white primary gets: there is no
 * light-theme storefront to build on it, and saying so in the stepper beats
 * shipping an invisible button.
 */

/** Every token key the brand-tokens doc declares, in its table order. */
export const BRAND_TOKEN_KEYS = [
  '--brand-bg',
  '--brand-surface',
  '--brand-surface-elevated',
  '--brand-text',
  '--brand-text-muted',
  '--brand-text-inverse',
  '--brand-primary',
  '--brand-primary-hover',
  '--brand-primary-active',
  '--brand-on-primary',
  '--brand-accent',
  '--brand-on-accent',
  '--brand-success',
  '--brand-warning',
  '--brand-error',
  '--brand-info',
  '--brand-border',
  '--brand-border-strong',
  '--brand-border-interactive',
  '--brand-focus-ring',
  '--brand-surface-strong',
  '--brand-on-functional',
] as const;

export type BrandTokenKey = (typeof BRAND_TOKEN_KEYS)[number];
export type BrandTokens = Record<BrandTokenKey, string>;

export interface BrandBaseColors {
  primary: string;
  secondary: string | null;
  accent: string | null;
}

/**
 * One recorded move. `no-accent-given` and `accent-from-secondary` record a
 * resolution the operator did not make explicitly; `contrast` records a
 * lightness move, with the pair and the ratio it reached.
 */
export interface PaletteAdjustment {
  token: BrandTokenKey;
  reason: 'contrast' | 'no-accent-given' | 'accent-from-secondary';
  from: string;
  to: string;
  against?: BrandTokenKey;
  ratio?: number;
}

export interface GeneratedPalette {
  tokens: BrandTokens;
  adjustments: PaletteAdjustment[];
}

/** Thrown when no lightness move rescues a pair. Carries the pair in its message. */
export class PaletteContrastError extends Error {
  constructor(
    readonly subject: BrandTokenKey,
    readonly ground: BrandTokenKey,
    readonly ratio: number,
    readonly floor: number,
  ) {
    super(
      `${subject} on ${ground} measures ${ratio.toFixed(2)}:1, below the ${floor}:1 floor, ` +
        `and ${subject} is a colour the operator entered, so it cannot be moved. ` +
        `Choose a colour with more contrast against a light page.`,
    );
    this.name = 'PaletteContrastError';
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Hsl {
  h: number;
  s: number;
  l: number;
}

function parseHex(value: string): Rgb {
  if (!HEX.test(value)) {
    throw new Error(`${value} is not a six-digit hex colour`);
  }
  const n = Number.parseInt(value.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return { r: channel(hn + 1 / 3) * 255, g: channel(hn) * 255, b: channel(hn - 1 / 3) * 255 };
}

/** WCAG 2.2 relative luminance. */
function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.2 contrast ratio, 1 to 21. Symmetric in its arguments. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function withLightness(hex: string, l: number): string {
  const hsl = rgbToHsl(parseHex(hex));
  return toHex(hslToRgb({ ...hsl, l: Math.max(0, Math.min(1, l)) }));
}

function hsl(h: number, s: number, l: number): string {
  return toHex(hslToRgb({ h, s, l }));
}

/**
 * Move `hex` along its own lightness until it clears `floor` against `ground`,
 * keeping its hue and saturation. Returns null when the whole range fails,
 * which only happens for a colour the caller is not allowed to move.
 *
 * The search walks both directions from the starting lightness and takes the
 * first pass, so a colour is never darkened when a smaller lightening would
 * have done, and the result stays as close to the input as the floor allows.
 */
function fitContrast(hex: string, ground: string, floor: number): string | null {
  if (contrastRatio(hex, ground) >= floor) return hex;
  const start = rgbToHsl(parseHex(hex)).l;
  for (let step = 1; step <= 100; step += 1) {
    const delta = step / 100;
    for (const candidate of [
      withLightness(hex, start - delta),
      withLightness(hex, start + delta),
    ]) {
      if (contrastRatio(candidate, ground) >= floor) return candidate;
    }
  }
  return null;
}

const AA_TEXT = 4.5;
const UI_COMPONENT = 3;

/**
 * How far a seed colour may move in lightness before it stops being the colour
 * the operator entered. Beyond this the generator rejects rather than ships a
 * palette whose primary is visibly not the brand.
 */
const MAX_SEED_SHIFT = 0.25;

/**
 * Expand one to three base colours into the full token set.
 *
 * @throws {PaletteContrastError} when a colour the operator entered cannot
 *   carry its floor against the generated page background.
 * @throws {Error} when a base colour is not a six-digit hex string.
 */
export function generatePalette(base: BrandBaseColors): GeneratedPalette {
  const primary = base.primary.toLowerCase();
  parseHex(primary);

  const adjustments: PaletteAdjustment[] = [];
  const record = (
    token: BrandTokenKey,
    reason: PaletteAdjustment['reason'],
    from: string,
    to: string,
  ): void => {
    adjustments.push({ token, reason, from, to });
  };

  const primaryHsl = rgbToHsl(parseHex(primary));

  // Neutrals: the primary's hue at a saturation low enough to read as neutral,
  // so the page carries a trace of the brand without competing with it.
  const neutralSaturation = Math.min(primaryHsl.s, 0.5) * 0.12;
  const neutral = (l: number): string => hsl(primaryHsl.h, neutralSaturation, l);

  const bg = neutral(0.99);
  const surface = neutral(0.955);
  const surfaceElevated = neutral(1);

  const text = fitDerived('--brand-text', neutral(0.11), [bg, surface, surfaceElevated], AA_TEXT);
  const textMuted = fitDerived(
    '--brand-text-muted',
    neutral(0.42),
    [bg, surface, surfaceElevated],
    AA_TEXT,
  );
  const textInverse = neutral(0.99);

  // The primary is both a button ground and a text colour: it grounds the
  // primary button, and it is what a link, a breadcrumb and a tertiary button
  // label render in. So it carries the text floor against the page, not the
  // 3:1 component floor. Fitting it at 3:1 left a legal palette in which every
  // link on the site sat at 3.2:1, which the a11y audit named.
  //
  // It must also carry its own label at AA. A mid-tone seed can fail that
  // while neither black nor white rescues the label, which is why the ground
  // moves rather than only the text.
  const primaryFit = fitGround(primary, [bg, surface], [text, textInverse], AA_TEXT);
  if (!primaryFit) {
    throw new PaletteContrastError(
      '--brand-primary',
      '--brand-bg',
      contrastRatio(primary, bg),
      AA_TEXT,
    );
  }
  if (primaryFit.ground !== primary) {
    adjustments.push({
      token: '--brand-primary',
      reason: 'contrast',
      from: primary,
      to: primaryFit.ground,
      against: '--brand-bg',
      ratio: Math.round(contrastRatio(primaryFit.ground, bg) * 100) / 100,
    });
  }
  const primaryGround = primaryFit.ground;

  let accentSeed = base.accent?.toLowerCase() ?? null;
  if (accentSeed) {
    parseHex(accentSeed);
  } else if (base.secondary) {
    accentSeed = base.secondary.toLowerCase();
    parseHex(accentSeed);
    record('--brand-accent', 'accent-from-secondary', base.secondary, accentSeed);
  } else {
    accentSeed = primaryGround;
    record('--brand-accent', 'no-accent-given', primaryGround, primaryGround);
  }

  // The accent is a fill behind its own text, not a boundary against the page:
  // an amber badge is a legitimate accent and would never clear 3:1 on white.
  // Its only floor is the text it carries.
  const accentFit = fitGround(accentSeed, null, [text, textInverse]);
  if (!accentFit) {
    throw new PaletteContrastError(
      '--brand-on-accent',
      '--brand-accent',
      Math.max(contrastRatio(text, accentSeed), contrastRatio(textInverse, accentSeed)),
      AA_TEXT,
    );
  }
  if (accentFit.ground !== accentSeed) {
    adjustments.push({
      token: '--brand-accent',
      reason: 'contrast',
      from: accentSeed,
      to: accentFit.ground,
      against: '--brand-on-accent',
      ratio: Math.round(contrastRatio(accentFit.ground, accentFit.on) * 100) / 100,
    });
  }
  const accent = accentFit.ground;
  const onAccent = accentFit.on;

  // Hover and active move the ground away from its own label, so each state
  // keeps at least the contrast the resting state was fitted for.
  const groundHsl = rgbToHsl(parseHex(primaryGround));
  const awayFromLabel = luminance(primaryFit.on) > luminance(primaryGround) ? -1 : 1;
  const shift = (by: number): string =>
    withLightness(primaryGround, groundHsl.l + awayFromLabel * by);
  const primaryHover = shift(0.07);
  const primaryActive = shift(0.14);
  const onPrimary = primaryFit.on;

  // Functional hues are fixed by convention (green reads as success in every
  // palette) and only their lightness is tuned, so they stay recognisable.
  //
  // Fitted against all three surfaces, not the page alone. A product card
  // grounds on `--brand-surface` and renders the success and warning colours
  // as text on it; fitting only against `--brand-bg` left those two pairs at
  // roughly 4.2:1 in every shipped fixture, which the a11y audit measured.
  const functional = (key: BrandTokenKey, hue: number): string =>
    fitDerived(
      key,
      hsl(hue, 0.62, Math.min(0.45, primaryHsl.l + 0.1)),
      [bg, surface, surfaceElevated],
      AA_TEXT,
    );

  // Computed once: each call to `functional` fits and records an adjustment,
  // so calling it twice per hue would double every record.
  const success = functional('--brand-success', 145);
  const warning = functional('--brand-warning', 38);
  const error = functional('--brand-error', 4);
  const info = functional('--brand-info', 208);
  const functionals = [success, warning, error, info];

  const border = neutral(0.9);
  // Both grounds it sits on: a category chip and a variant selector ground on
  // `--brand-surface` and take this as their boundary, where fitting against
  // the page alone left it near 2.8:1 under every shipped fixture.
  const borderStrong = fitDerived(
    '--brand-border-strong',
    neutral(0.72),
    [bg, surface],
    UI_COMPONENT,
  );
  // The resting boundary of a form control. Fitted here rather than mixed in
  // the stylesheet: a `color-mix` toward the page background moves a boundary
  // colour the wrong way, and left every input border at about 2.5:1 against
  // the page, under the 3:1 WCAG 1.4.11 floor it was supposed to clear.
  const borderInteractive = fitDerived(
    '--brand-border-interactive',
    neutral(0.66),
    [bg, surface],
    UI_COMPONENT,
  );
  const focusRing = fitDerived('--brand-focus-ring', primaryGround, [bg], UI_COMPONENT);

  // The hover ground of a secondary or tertiary button, which keeps its
  // resting label colour. That label is `--brand-primary`, and the muted text
  // colour also lands here, so the ground is fitted against both rather than
  // mixed in the stylesheet: as a `color-mix` toward the text it measured
  // about 3.2:1 for the label, which a live axe run caught on the cart.
  const surfaceStrong = fitDerived(
    '--brand-surface-strong',
    neutral(0.93),
    [primaryGround, textMuted],
    AA_TEXT,
  );

  // The label on a functional-colour fill: a toast or a badge grounds on
  // `--brand-success` and the like. Those colours are fitted to carry text on
  // a light page, so they are dark, and the label that reads on them is the
  // inverse neutral. Fitted against all four so one token serves every state.
  const onFunctional = fitDerived('--brand-on-functional', textInverse, functionals, AA_TEXT);

  const tokens: BrandTokens = {
    '--brand-bg': bg,
    '--brand-surface': surface,
    '--brand-surface-elevated': surfaceElevated,
    '--brand-text': text,
    '--brand-text-muted': textMuted,
    '--brand-text-inverse': textInverse,
    '--brand-primary': primaryGround,
    '--brand-primary-hover': primaryHover,
    '--brand-primary-active': primaryActive,
    '--brand-on-primary': onPrimary,
    '--brand-accent': accent,
    '--brand-on-accent': onAccent,
    '--brand-success': success,
    '--brand-warning': warning,
    '--brand-error': error,
    '--brand-info': info,
    '--brand-border': border,
    '--brand-border-strong': borderStrong,
    '--brand-border-interactive': borderInteractive,
    '--brand-focus-ring': focusRing,
    '--brand-surface-strong': surfaceStrong,
    '--brand-on-functional': onFunctional,
  };

  return { tokens, adjustments };

  /**
   * Fit one derived colour against every ground it will sit on. The worst
   * ground wins, so a text colour that passes on the page but not on a card
   * moves once for both.
   */
  function fitDerived(
    token: BrandTokenKey,
    start: string,
    grounds: string[],
    floor: number,
  ): string {
    let value = start;
    for (const ground of grounds) {
      const fitted = fitContrast(value, ground, floor);
      if (fitted === null) {
        throw new PaletteContrastError(
          token,
          groundToken(ground),
          contrastRatio(value, ground),
          floor,
        );
      }
      value = fitted;
    }
    if (value !== start) {
      const worst = grounds.reduce((a, b) =>
        contrastRatio(value, a) <= contrastRatio(value, b) ? a : b,
      );
      adjustments.push({
        token,
        reason: 'contrast',
        from: start,
        to: value,
        against: groundToken(worst),
        ratio: Math.round(contrastRatio(value, worst) * 100) / 100,
      });
    }
    return value;
  }

  /** Name the ground a move was measured against, for the adjustment record. */
  function groundToken(ground: string): BrandTokenKey {
    if (ground === bg) return '--brand-bg';
    if (ground === surface) return '--brand-surface';
    if (ground === surfaceElevated) return '--brand-surface-elevated';
    if (ground === primaryGround) return '--brand-primary';
    if (ground === success) return '--brand-success';
    if (ground === warning) return '--brand-warning';
    if (ground === error) return '--brand-error';
    if (ground === info) return '--brand-info';
    return '--brand-surface-strong';
  }
}

/**
 * Fit a seed colour that will be used as a ground, together with the label it
 * has to carry.
 *
 * The seed moves, unlike a derived colour, because a mid-tone brand colour can
 * be one no label rescues: neither black nor white reaches AA on a saturated
 * red, so the ground itself has to give. The move is bounded to
 * {@link MAX_SEED_SHIFT} of lightness, which is what keeps the result the
 * operator's colour rather than a different one, and what makes a near-white
 * seed a rejection instead of a silent slide to mid-grey.
 *
 * `pageGrounds` are the surfaces the colour must also carry a floor against,
 * and null when it need not (a badge fill). `pageFloor` is that floor: the 3:1
 * component floor for a colour that is only ever a ground, the 4.5:1 text
 * floor for one the interface also renders as text. The primary takes every
 * surface, because a header grounds on `--brand-surface` and renders its links
 * in the primary.
 *
 * Returns the fitted ground and the label that goes on it, or null when the
 * bounded range holds no pair that passes.
 */
function fitGround(
  seed: string,
  pageGrounds: readonly string[] | null,
  labels: readonly string[],
  pageFloor: number = UI_COMPONENT,
): { ground: string; on: string } | null {
  const start = rgbToHsl(parseHex(seed)).l;
  const passes = (ground: string, label: string): boolean =>
    contrastRatio(ground, label) >= AA_TEXT &&
    (pageGrounds === null || pageGrounds.every((page) => contrastRatio(ground, page) >= pageFloor));

  for (let step = 0; step <= MAX_SEED_SHIFT * 100; step += 1) {
    const delta = step / 100;
    for (const candidate of step === 0
      ? [seed]
      : [withLightness(seed, start - delta), withLightness(seed, start + delta)]) {
      // Prefer the label with the most headroom, so the smallest ground move wins.
      const best = labels.reduce((a, b) =>
        contrastRatio(candidate, a) >= contrastRatio(candidate, b) ? a : b,
      );
      if (passes(candidate, best)) return { ground: candidate, on: best };
    }
  }
  return null;
}
