/**
 * Checks a live site against the detector fingerprint in
 * `tools/fingerprint/themerchantengine.json`, the same entry submitted to the
 * open detector databases.
 *
 *   npm run fingerprint:check -- https://shop.example.com
 *
 * It matches the header, the generator meta and the DOM selector the way a
 * detector does. The `js` global needs a browser, so it is reported, not
 * checked. Exits 1 when no rule matches.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Fingerprint {
  readonly meta?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly js?: Record<string, string>;
  readonly dom?: string;
}

export interface FetchedPage {
  readonly headers: Record<string, string>;
  readonly html: string;
}

export interface CheckResult {
  readonly rule: string;
  readonly matched: boolean;
  readonly version?: string;
  readonly note?: string;
}

export const FINGERPRINT_FILE = path.resolve(
  __dirname,
  '..',
  'tools',
  'fingerprint',
  'themerchantengine.json',
);

export function loadFingerprint(file = FINGERPRINT_FILE): Fingerprint {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Fingerprint>;
  const entry = entries['themerchantengine'];
  if (!entry) throw new Error(`${file} has no themerchantengine entry`);
  return entry;
}

/** A detector pattern is a regex followed by `\;`-separated tags such as `version:\1`. */
export function patternRegex(pattern: string): RegExp {
  const [source] = pattern.split('\\;');
  return new RegExp(source ?? '', 'i');
}

function matchValue(rule: string, pattern: string, value: string | undefined): CheckResult {
  if (value === undefined) return { rule, matched: false, note: 'absent' };
  const match = patternRegex(pattern).exec(value);
  if (!match) return { rule, matched: false, note: `value "${value}" does not match` };
  return match[1] ? { rule, matched: true, version: match[1] } : { rule, matched: true };
}

function attribute(tag: string, name: string): string | undefined {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = re.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

function metaContent(html: string, name: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (attribute(tag, 'name')?.toLowerCase() === name.toLowerCase()) {
      return attribute(tag, 'content');
    }
  }
  return undefined;
}

/** Supports the `tag[attr]` selector form the fingerprint uses. */
function domMatches(html: string, selector: string): boolean {
  const parts = /^([a-z][a-z0-9-]*)\[([a-z][a-z0-9-]*)\]$/i.exec(selector);
  if (!parts) throw new Error(`unsupported dom selector "${selector}"`);
  const [, tag, attr] = parts;
  const re = new RegExp(`<${tag}\\b[^>]*\\s${attr}(?=[\\s=/>])`, 'i');
  return re.test(html);
}

export function checkFingerprint(page: FetchedPage, fingerprint: Fingerprint): CheckResult[] {
  const headers = Object.fromEntries(
    Object.entries(page.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const results: CheckResult[] = [];
  for (const [name, pattern] of Object.entries(fingerprint.headers ?? {})) {
    results.push(matchValue(`header ${name}`, pattern, headers[name.toLowerCase()]));
  }
  for (const [name, pattern] of Object.entries(fingerprint.meta ?? {})) {
    results.push(matchValue(`meta ${name}`, pattern, metaContent(page.html, name)));
  }
  if (fingerprint.dom) {
    results.push({
      rule: `dom ${fingerprint.dom}`,
      matched: domMatches(page.html, fingerprint.dom),
    });
  }
  for (const name of Object.keys(fingerprint.js ?? {})) {
    results.push({ rule: `js ${name}`, matched: false, note: 'needs a browser, not checked' });
  }
  return results;
}

/** Detected when any header, meta or DOM rule matches, like a detector. */
export function isDetected(results: readonly CheckResult[]): boolean {
  return results.some((result) => result.matched);
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const response = await fetch(url, { redirect: 'follow' });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { headers, html: await response.text() };
}

if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: npm run fingerprint:check -- <url>');
    process.exit(2);
  }
  fetchPage(url)
    .then((page) => {
      const results = checkFingerprint(page, loadFingerprint());
      for (const result of results) {
        const mark = result.matched ? 'match' : 'miss ';
        const extra = result.version
          ? ` (version ${result.version})`
          : result.note
            ? ` (${result.note})`
            : '';
        console.log(`${mark}  ${result.rule}${extra}`);
      }
      const detected = isDetected(results);
      console.log(detected ? `${url} is detected as themerchantengine` : `${url} is not detected`);
      process.exit(detected ? 0 : 1);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    });
}
