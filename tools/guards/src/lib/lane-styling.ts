import { SourceFile, Violation, isCommentLine, lineAt } from './repo';

/**
 * The rules the retired `post-edit.sh` grepped after every edit, moved into a
 * gate that runs on the whole tree rather than only on the file just touched.
 *
 * These stay in a guard rather than in ESLint because most of the surface is
 * `.html` and `.css`, which the TypeScript parser never sees. ESLint keeps the
 * one rule it can express better: `bypassSecurityTrust*`.
 */

export const LANES = {
  admin: {
    dirs: [
      'apps/admin/src',
      'libs/admin-ui/src',
      'libs/admin-services/src',
      'libs/admin-types/src',
    ],
    section: '3.10',
    tokenFiles: ['apps/admin/src/styles.css'],
  },
  storefront: {
    dirs: ['apps/storefront/src', 'libs/storefront-services/src', 'libs/storefront-types/src'],
    section: '3.11',
    tokenFiles: ['apps/storefront/src/styles/brand.css'],
  },
} as const;

export const SCANNED_EXTENSIONS = ['.ts', '.html', '.css', '.scss'];

export interface LaneViolation extends Violation {
  /** Which rule fired. The baseline is keyed on file plus rule, so a file
   * cannot trade one kind of violation for another and stay green. */
  readonly rule: string;
}

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly message: (section: string) => string;
  /** Prose mentions of a rule are not uses of it. */
  readonly skipComments: boolean;
  /** When set, the rule is absolute rather than baselined, and this marker is
   * the named, reviewable exception that belongs next to the code. The marker
   * is matched per occurrence, within `waiverWindow` lines above the match, so
   * one approval cannot cover a second binding added to the same file later. */
  readonly waiver?: RegExp;
  readonly waiverWindow?: number;
}

const RULES: readonly Rule[] = [
  {
    id: 'physical-text-align',
    pattern: /\btext-(left|right)\b/,
    message: (s) => `physical text-left/text-right. Use text-start/text-end (constitution ${s}).`,
    skipComments: true,
  },
  {
    id: 'physical-spacing-utility',
    pattern: /\b(?:ml|mr|pl|pr)-(?:\d+|px|auto)\b/,
    message: (s) => `physical ml-/mr-/pl-/pr- utility. Use ms-/me-/ps-/pe- (constitution ${s}).`,
    skipComments: true,
  },
  {
    id: 'physical-positioning-utility',
    pattern: /(?:^|[\s"'`:])(?:left|right)-(?:\d+|px|full|auto|\[)/,
    message: (s) =>
      `physical left-*/right-* positioning. Use start-*/end-* or inset-inline-* (constitution ${s}).`,
    skipComments: true,
  },
  {
    id: 'physical-css-property',
    pattern: /\b(?:margin|padding|inset|border)-(?:left|right)(?:-\w+)?\s*:/,
    message: (s) =>
      `physical margin/padding/inset/border-left/right. Use the -inline- logical property (constitution ${s}).`,
    skipComments: true,
  },
  {
    id: 'inner-html-binding',
    pattern: /\[innerHTML\]=/,
    message: (s) =>
      `[innerHTML] binding. Render as text, or keep it only for server-sanitized rich text and add an "innerhtml-approved: <reason>" comment (constitution ${s}).`,
    skipComments: true,
    // Absolute, not baselined. This is the XSS rule; it does not belong in an
    // integer that also counts table-header alignment.
    waiver: /innerhtml-approved:\s*\S+/,
    // Each binding needs its own approval, directly above it. A file-wide
    // marker would have let a third binding join two approved ones unseen.
    waiverWindow: 10,
  },
  {
    id: 'hardcoded-locale',
    pattern: /[=!]==?\s*['"](?:fr|en|ar|de|es|it|pt|ja|zh|ru)['"]/,
    message: () =>
      'hardcoded locale literal in a comparison. Derive it from the configured locale set (constitution 3.2).',
    skipComments: true,
  },
  {
    id: 'hardcoded-hex-colour',
    // 3, 4, 6 and 8 digit forms. The alpha variants are still hex literals.
    pattern: /#[0-9a-fA-F]{3,4}\b|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/,
    message: (s) =>
      `hardcoded hex colour outside the token file. Use a CSS variable or a Tailwind token (constitution ${s}).`,
    skipComments: true,
  },
];

/** Rules that are enforced absolutely, with a named per-site waiver instead of
 * a baseline count. */
export const ABSOLUTE_RULES: readonly string[] = RULES.filter((r) => r.waiver).map((r) => r.id);

/** True when an approval marker sits within the rule's window above this line.
 * Line-scoped rather than file-scoped: the point of lifting a rule out of the
 * baseline is that a new occurrence cannot arrive unnoticed, and a marker that
 * covers a whole file gives that back. */
function approvedNearby(lines: readonly string[], line: number, rule: Rule): boolean {
  if (!rule.waiver) return false;
  const window = rule.waiverWindow ?? 10;
  const from = Math.max(0, line - 1 - window);
  return lines.slice(from, line).some((text) => rule.waiver?.test(text));
}

/** Specs assert on the strings they test, including the forbidden ones. */
function isSpec(path: string): boolean {
  return path.endsWith('.spec.ts') || path.includes('/__tests__/');
}

export function laneViolations(
  files: readonly SourceFile[],
  lane: { readonly section: string; readonly tokenFiles: readonly string[] },
): LaneViolation[] {
  const violations: LaneViolation[] = [];
  for (const file of files) {
    if (isSpec(file.path)) continue;
    const isTokenFile = lane.tokenFiles.includes(file.path);
    const lines = file.text.split('\n');
    for (const rule of RULES) {
      if (rule.id === 'hardcoded-hex-colour' && isTokenFile) continue;
      const regex = new RegExp(rule.pattern.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(file.text)) !== null) {
        if (rule.waiver && approvedNearby(lines, lineAt(file.text, match.index), rule)) {
          continue;
        }
        if (!rule.skipComments || !isCommentLine(file.text, match.index)) {
          violations.push({
            rule: rule.id,
            file: file.path,
            line: lineAt(file.text, match.index),
            message: `${rule.id}: ${rule.message(lane.section)}`,
          });
        }
        if (match.index === regex.lastIndex) regex.lastIndex++;
      }
    }
  }
  // Line order, so the delta below reports the newest violation in a file
  // rather than whichever rule happened to run first.
  return violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
}

/** Baseline key. File plus rule, never file alone: a per-file count lets a
 * file shed one violation and gain a different one and stay green. */
export function baselineKey(violation: LaneViolation): string {
  return `${violation.file}::${violation.rule}`;
}

export function countByKey(violations: readonly LaneViolation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const violation of violations) {
    const key = baselineKey(violation);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
