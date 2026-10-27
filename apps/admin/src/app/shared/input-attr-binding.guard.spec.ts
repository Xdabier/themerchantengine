import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Recurrence guard: `[attr.x]` on an `<app-input>` never reaches its input.
 *
 * D4 gave the `<app-input>` atom real `step` and `min` signal inputs, because
 * the atom previously declared neither and every `step="0.01"` written on one
 * landed as a dead attribute on a custom element, leaving the field stepping
 * by 1. Eight of the twelve consumer sites were then written as
 * `[attr.step]="moneyStep()"` on the `<app-input>` element itself.
 *
 * In Angular, `[attr.x]` always writes a DOM attribute on the host through the
 * renderer and never routes to a declared `@Input` or signal input. So the
 * atom received a dead `step` attribute, `step()` stayed `null`, the inner
 * `[attr.step]="step()"` removed the attribute, and the field behaved exactly
 * as it had before the fix. The deliverable was reported closed while the
 * defect it named was still live, bit for bit.
 *
 * The atom's own spec cannot catch this: it binds correctly and passes. The
 * defect is in the callers, so this scans the source.
 *
 * A native `<input>` is a real element, so `[attr.step]` on one is correct and
 * this guard must not flag it. That is why the check is anchored to the
 * `<app-input>` opening tag rather than to the attribute alone.
 */

const SRC = join(__dirname, '..', '..');

/** Inputs the atom declares. `[attr.x]` on any of them is the bug. */
const FORWARDED = ['step', 'min', 'suffix', 'error', 'hint', 'fieldId'];

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/** Each `<app-input ...>` opening tag. Built fresh: `/g` regexes are stateful. */
const appInputTag = (): RegExp => /<app-input\b[^>]*>/g;

describe('no [attr.x] binding on an <app-input>', () => {
  const files = collect(SRC).filter((f) => appInputTag().test(readFileSync(f, 'utf8')));

  it('finds the app-input call sites to scan', () => {
    // If this drops to zero the guard has stopped guarding anything.
    expect(files.length).toBeGreaterThan(5);
  });

  it('binds every forwarded input as [x], never as [attr.x]', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const tag of src.match(appInputTag()) ?? []) {
        for (const name of FORWARDED) {
          if (new RegExp(`\\[attr\\.${name}\\]`).test(tag)) {
            offenders.push(`${relative(SRC, file)} → [attr.${name}] on <app-input>`);
          }
        }
      }
    }
    // If this fails: drop the `attr.` prefix. `[attr.step]` writes a dead DOM
    // attribute on the custom element; `[step]` reaches the signal input.
    expect(offenders).toEqual([]);
  });
});
