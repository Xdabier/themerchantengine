import { SourceFile, isCommentLine } from './repo';

/**
 * The markers `/defer-report` used to grep for. Kept in one module so the
 * guard and the baseline it compares against can never drift apart.
 *
 * `placeholder` is matched only in its deferral sense. The word is also a
 * legitimate UI term here (an input's placeholder text, the em-dash rendered
 * for a nullish value) and banning it outright would report 230 non-findings.
 */
export const MARKER_PATTERN = new RegExp(
  [
    // Unambiguous markers.
    String.raw`\b(?:TODO|FIXME|HACK|XXX)\b`,
    // "deferred to a later phase", "deferral of the real client".
    String.raw`\bdefer(?:red|ral)\s+(?:to|until|into)\b`,
    // "stubbed for now", "stubbed until the endpoint lands". A comment that
    // merely states a test double is stubbed is a description, not a debt.
    String.raw`\bstub(?:bed|s|bing)?\s+(?:for\s+now|until|out\s+until|pending)\b`,
    String.raw`\bplaceholder\s+(?:implementation|for\s+now|until)\b`,
    // "Phase 9 will replace this", "wired in a later phase".
    String.raw`\bPhase\s+\d+[^\n]{0,80}\b(?:will|later|follow-?up|to\s+be|not\s+yet)\b`,
    String.raw`\b(?:in|at)\s+a\s+(?:later|future|follow-?up)\s+phase\b`,
  ].join('|'),
  'i',
);

export const SCANNED_DIRS = ['apps', 'libs'];

export const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.html', '.css', '.scss'];

/** Marker hits per repo-relative file. Files with none are absent. */
export function countMarkers(files: readonly SourceFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const regex = new RegExp(MARKER_PATTERN.source, `${MARKER_PATTERN.flags.replace('g', '')}g`);
  for (const file of files) {
    regex.lastIndex = 0;
    let hits = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(file.text)) !== null) {
      // A marker is prose. Matching only comment lines keeps a string constant
      // named "todoCount" or a test asserting on the word out of the count.
      if (isCommentLine(file.text, match.index)) hits++;
      if (match.index === regex.lastIndex) regex.lastIndex++;
    }
    if (hits > 0) counts[file.path] = hits;
  }
  return counts;
}
