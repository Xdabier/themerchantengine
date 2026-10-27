import { contrastRatio } from '@common/brand';
import { test, expect } from './_auth-fixture';

/**
 * Every documented text-on-ground pair, measured in both colour modes against
 * a real browser (`agent_docs/admin/brand-tokens.md`, section Contrast floor).
 *
 * axe measures the contrast of elements it finds on the page, which means a
 * token that only appears on a screen no journey visits is never checked, and
 * a mode nothing renders in is never checked at all. This reads the tokens
 * themselves out of the computed style of the live document, so a pair is
 * covered whether or not anything on screen happens to use it today. That is
 * the difference that matters for light mode: it is new, almost nothing has
 * been rendered in it, and a colour that fails is invisible until someone
 * switches.
 */

/** Floors from the doc. `ink-disabled` is exempt and checked separately. */
const BODY_FLOOR = 7;
const LARGE_FLOOR = 4.5;

interface Pair {
  readonly text: string;
  readonly ground: string;
  readonly floor: number;
}

const PAIRS: readonly Pair[] = [
  { text: '--ink', ground: '--surface', floor: BODY_FLOOR },
  { text: '--ink', ground: '--surface-elevated', floor: BODY_FLOOR },
  { text: '--ink-emphasis', ground: '--surface', floor: BODY_FLOOR },
  { text: '--ink-emphasis', ground: '--surface-elevated', floor: BODY_FLOOR },
  { text: '--ink-muted', ground: '--surface', floor: LARGE_FLOOR },
  { text: '--ink-muted', ground: '--surface-elevated', floor: LARGE_FLOOR },
  { text: '--on-emphasis', ground: '--surface-emphasis', floor: LARGE_FLOOR },
  { text: '--on-emphasis', ground: '--surface-emphasis-hover', floor: LARGE_FLOOR },
  ...['success', 'warning', 'error', 'info'].flatMap((status) => [
    { text: `--status-${status}`, ground: '--surface', floor: LARGE_FLOOR },
    { text: `--status-${status}`, ground: '--surface-elevated', floor: LARGE_FLOOR },
    { text: `--on-status-${status}`, ground: `--status-${status}-tint`, floor: LARGE_FLOOR },
    { text: `--on-status-${status}-fill`, ground: `--status-${status}-fill`, floor: LARGE_FLOOR },
  ]),
];

const ALL_TOKENS = [...new Set(PAIRS.flatMap((pair) => [pair.text, pair.ground]))];

/** `10 10 10` as the tokens declare it, to the `#0a0a0a` the ratio wants. */
function toHex(channels: string): string {
  const parts = channels.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`not an RGB channel triplet: "${channels}"`);
  }
  return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('');
}

for (const mode of ['dark', 'light'] as const) {
  test.describe(`${mode} mode`, () => {
    test(`every documented pair meets its contrast floor`, async ({ page }) => {
      await page.goto('/settings', { waitUntil: 'networkidle' });
      await expect(
        page.locator('[data-testid="app-shell-main"]'),
        'the admin shell never mounted, so no token was measured',
      ).toBeVisible({ timeout: 15_000 });

      const resolved = await page.evaluate(
        ({ tokens, theme }) => {
          document.documentElement.setAttribute('data-theme', theme);
          const style = getComputedStyle(document.documentElement);
          const out: Record<string, string> = {};
          for (const token of tokens) out[token] = style.getPropertyValue(token).trim();
          return { active: document.documentElement.getAttribute('data-theme'), out };
        },
        { tokens: ALL_TOKENS, theme: mode },
      );

      expect(resolved.active, 'the mode under test was not applied').toBe(mode);

      const failures: string[] = [];
      for (const pair of PAIRS) {
        const key = `${mode} ${pair.text} on ${pair.ground}`;
        const text = resolved.out[pair.text];
        const ground = resolved.out[pair.ground];
        // An undeclared custom property resolves to an empty string and the
        // element silently inherits, which is exactly the failure this probe
        // exists to catch, so it is a failure rather than a skip.
        if (!text || !ground) {
          failures.push(`${key}: one of them is not declared`);
          continue;
        }
        const ratio = contrastRatio(toHex(text), toHex(ground));
        if (ratio < pair.floor) {
          failures.push(`${key}: ${ratio.toFixed(2)}:1, below ${pair.floor}:1`);
        }
      }

      // Zero tolerance, which is what the document promises. There is no
      // allowlist here on purpose: the two pairs that failed when this probe
      // first ran were fixed with dark-mode ink variants rather than recorded.
      expect(failures, `contrast floor breached in ${mode} mode`).toEqual([]);
    });

    test('the disabled ink is visibly dimmer than the muted ink', async ({ page }) => {
      // The doc exempts `--ink-disabled` from the text ratio and requires it to
      // differ visibly from `--ink-muted`. Without that, "disabled" and
      // "secondary" render identically and the control reads as pressable.
      await page.goto('/settings', { waitUntil: 'networkidle' });
      const resolved = await page.evaluate((theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        const style = getComputedStyle(document.documentElement);
        return {
          surface: style.getPropertyValue('--surface').trim(),
          muted: style.getPropertyValue('--ink-muted').trim(),
          disabled: style.getPropertyValue('--ink-disabled').trim(),
        };
      }, mode);

      const mutedRatio = contrastRatio(toHex(resolved.muted), toHex(resolved.surface));
      const disabledRatio = contrastRatio(toHex(resolved.disabled), toHex(resolved.surface));
      expect(
        mutedRatio - disabledRatio,
        `muted ${mutedRatio.toFixed(2)}:1 and disabled ${disabledRatio.toFixed(2)}:1 are too close to tell apart`,
      ).toBeGreaterThan(1);
    });
  });
}
