import type { SourceFile, Violation } from './repo';
import { LANES } from './lane-styling';

/**
 * Finds live regions (`role="alert"`, `role="status"`, `aria-live="polite"`,
 * `aria-live="assertive"`) that are the first element inside an `@if`,
 * `@else if`, `@else`, `@case` or `@default` block. Such an element enters the
 * DOM together with its message, so assistive technology has nothing to diff
 * against and stays silent. The accepted shape is a persistent wrapper whose
 * content is conditional:
 *
 *   <div role="status">@if (saved()) { Saved }</div>
 *
 * Bound: the block opener must end its line with `{`, which is how prettier
 * formats every control-flow block in the tree. A one-line
 * `@if (x) { <p role="alert">..</p> }` is not inspected.
 */
export const LIVE_REGION_DIRS: readonly string[] = LANES.admin.dirs;

export const LIVE_REGION_EXTENSIONS: readonly string[] = ['.ts', '.html'];

export const LIVE_REGION_RULE = 'conditional-live-region';

export interface LiveRegionViolation extends Violation {
  rule: typeof LIVE_REGION_RULE;
  /** The attribute that makes the element a live region, normalised to `name="value"`. */
  marker: string;
}

const BLOCK_OPEN = /^\s*(?:\}\s*)?@(?:if|else if|else|case|default)\b[^{]*\{\s*$/;
const LIVE_MARKER =
  /\b(role\s*=\s*["'](?:alert|status)["']|aria-live\s*=\s*["'](?:polite|assertive)["'])/;

function isSpec(path: string): boolean {
  return /\.(spec|test)\.ts$/.test(path);
}

/** The opening tag that starts at `lines[start]`, joined until its closing `>`. */
function openingTag(lines: readonly string[], start: number): string | null {
  if (!lines[start].trimStart().startsWith('<') || lines[start].trimStart().startsWith('</')) {
    return null;
  }
  const parts: string[] = [];
  for (let i = start; i < lines.length && i < start + 40; i += 1) {
    parts.push(lines[i]);
    if (lines[i].includes('>')) return parts.join(' ');
  }
  return null;
}

export function liveRegionViolations(files: readonly SourceFile[]): LiveRegionViolation[] {
  const out: LiveRegionViolation[] = [];
  for (const file of files) {
    if (isSpec(file.path)) continue;
    const lines = file.text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!BLOCK_OPEN.test(lines[i])) continue;
      let next = i + 1;
      while (next < lines.length && lines[next].trim() === '') next += 1;
      if (next >= lines.length) continue;
      const tag = openingTag(lines, next);
      if (!tag) continue;
      const match = LIVE_MARKER.exec(tag);
      if (!match) continue;
      const marker = match[1].replace(/\s*=\s*["']([^"']+)["']/, '="$1"');
      out.push({
        file: file.path,
        line: next + 1,
        rule: LIVE_REGION_RULE,
        marker,
        message: `${LIVE_REGION_RULE}: ${marker} is mounted by the control-flow block on line ${i + 1}; keep the live region in the DOM and make only its content conditional`,
      });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function baselineKey(v: LiveRegionViolation): string {
  return `${v.file}::${v.rule}`;
}

export function countByKey(violations: readonly LiveRegionViolation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    const key = baselineKey(v);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
