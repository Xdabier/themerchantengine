import * as path from 'node:path';
import {
  PaletteContrastError,
  contrastRatio,
  generatePalette,
  type GeneratedPalette,
} from '../../../../libs/shared/common/src/brand/palette';
import { fontKitCoversLocale } from '../../../../libs/shared/common/src/locale/locale-registry';
import { STORE_CONFIG_FONT_KITS } from '../../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { ui, type Output } from '../cli/ui';
import { StepFailed, isHexColor, type Step } from './types';

export const FONT_KIT_LABELS: Record<(typeof STORE_CONFIG_FONT_KITS)[number], string> = {
  'latin-rounded': 'latin-rounded: Baloo 2, Inter and JetBrains Mono (Latin scripts)',
  'arabic-latin': 'arabic-latin: Cairo, Tajawal and Nunito (Arabic and Latin scripts)',
};

/** The token pairs the preview reports, subject on ground, the way the pages render them. */
const REPORTED_PAIRS: readonly [string, string][] = [
  ['--brand-text', '--brand-bg'],
  ['--brand-text-muted', '--brand-bg'],
  ['--brand-on-primary', '--brand-primary'],
  ['--brand-primary', '--brand-bg'],
];

export function printPalette(out: Output, palette: GeneratedPalette): void {
  const tokens = palette.tokens as Record<string, string>;
  for (const key of [
    '--brand-primary',
    '--brand-primary-hover',
    '--brand-accent',
    '--brand-bg',
    '--brand-surface',
    '--brand-text',
  ]) {
    if (tokens[key]) out.write(`  ${ui.swatch(out, tokens[key], key)}\n`);
  }
  for (const [subject, ground] of REPORTED_PAIRS) {
    if (!tokens[subject] || !tokens[ground]) continue;
    const ratio = contrastRatio(tokens[subject], tokens[ground]);
    ui.note(
      out,
      `${subject} on ${ground}: ${ratio.toFixed(2)}:1${ratio >= 4.5 ? '' : ' (below AA)'}`,
    );
  }
  for (const move of palette.adjustments) {
    ui.note(
      out,
      `${move.token}: ${move.from} -> ${move.to} (${move.reason}${move.ratio ? `, ${move.ratio.toFixed(2)}:1` : ''})`,
    );
  }
}

/**
 * Brand (plan E4.3): one to three base colours through the shared palette
 * generator, previewed in the terminal with its contrast report, plus the
 * font kit and an optional logo the runner uploads.
 */
export const brandStep: Step = {
  id: 'brand',
  title: 'Brand',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const brand = ctx.answers.brand ?? {};
    const colour = (label: string) => (v: string) =>
      v === '' || isHexColor(v) ? null : `${label} must be a hex colour like #1F4E79`;
    const primary = await ctx.prompter.text({
      path: 'brand.primary',
      label: 'Primary colour (hex)',
      initial: brand.primary,
      validate: (v) => (isHexColor(v) ? null : 'a hex colour like #1F4E79'),
    });
    const secondary = await ctx.prompter.text({
      path: 'brand.secondary',
      label: 'Secondary colour (hex, or empty)',
      initial: brand.secondary ?? '',
      validate: colour('the secondary colour'),
    });
    const accent = await ctx.prompter.text({
      path: 'brand.accent',
      label: 'Accent colour (hex, or empty)',
      initial: brand.accent ?? '',
      validate: colour('the accent colour'),
    });
    let palette: GeneratedPalette;
    try {
      palette = generatePalette({
        primary,
        secondary: secondary || null,
        accent: accent || null,
      });
    } catch (err) {
      if (err instanceof PaletteContrastError) throw new StepFailed('brand', err.message);
      throw err;
    }
    printPalette(ctx.out, palette);

    const served = ctx.answers.localization?.supportedLocales ?? [];
    const fontKit = await ctx.prompter.select({
      path: 'brand.fontKit',
      label: 'Font kit',
      initial:
        brand.fontKit ??
        STORE_CONFIG_FONT_KITS.find((kit) => served.every((l) => fontKitCoversLocale(kit, l))) ??
        STORE_CONFIG_FONT_KITS[0],
      choices: STORE_CONFIG_FONT_KITS.map((value) => ({ value, label: FONT_KIT_LABELS[value] })),
    });
    const logoPath = await ctx.prompter.text({
      path: 'brand.logoPath',
      label: 'Logo file (PNG or SVG path, or empty for none)',
      initial: brand.logoPath ?? '',
      validate: (v) => {
        if (v === '') return null;
        if (!/\.(png|svg|jpe?g|webp)$/i.test(v)) return 'a .png, .svg, .jpg or .webp file';
        return ctx.ports.fileExists(path.resolve(ctx.root, v)) ? null : `no file at ${v}`;
      },
    });
    ctx.answers.brand = {
      primary,
      secondary: secondary || null,
      accent: accent || null,
      fontKit,
      logoPath,
    };
  },
};
