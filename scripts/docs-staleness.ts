/**
 * The ninety-day refresh report (plan `product-site-and-docs` L6.5).
 *
 * Every public page carries an `updated` date in its frontmatter, and the rule
 * the measurement record states is that the date moves when the content
 * changes, never as a routine bump. That makes the date honest and it makes
 * this report possible: which pages nobody has read against the code for a
 * quarter, and what query each of them is meant to answer.
 *
 *   npm run docs:staleness              # pages older than ninety days
 *   npm run docs:staleness -- --days 30 # a tighter window
 *   npm run docs:staleness -- --all     # every page, oldest first
 *
 * It is a report, not a gate: it never fails a build. A page can be correct and
 * old. What it cannot be is unread.
 *
 * The marketing pages on the product site (/compare and /features) carry their
 * date in the page itself and are listed by that repository's own guard; this
 * report covers the documentation tree, which is where the pages live.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';

export interface PageAge {
  /** Path relative to `docs/site`. */
  readonly file: string;
  readonly title: string;
  readonly primaryQuery: string;
  readonly updated: string;
  readonly ageInDays: number;
}

const DAY = 24 * 60 * 60 * 1000;

function* markdownFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

/**
 * Every page under `root`, oldest first, with its age on `today`.
 *
 * A page whose frontmatter has no usable `updated` date is reported with an age
 * of `Infinity` rather than skipped: a page with no date is the worst case of
 * the thing this report looks for, not an exception to it.
 */
export function pageAges(root: string, today: Date): PageAge[] {
  const pages: PageAge[] = [];
  for (const file of markdownFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (rel === 'README.md') continue;
    const body = fs.readFileSync(file, 'utf8');
    const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    let front: Record<string, unknown> = {};
    if (match) {
      try {
        front = (yaml.load(match[1]) as Record<string, unknown>) ?? {};
      } catch {
        front = {};
      }
    }
    // An unquoted ISO date in frontmatter is a Date to YAML, not a string, so
    // reading it as a string only is how this report silently found nothing.
    const raw = front.updated;
    const updated =
      raw instanceof Date ? raw.toISOString().slice(0, 10) : typeof raw === 'string' ? raw : '';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(updated)
      ? Date.parse(`${updated}T00:00:00Z`)
      : Number.NaN;
    pages.push({
      file: rel,
      title: typeof front.title === 'string' ? front.title : '(no title)',
      primaryQuery:
        typeof front.primaryQuery === 'string' ? front.primaryQuery : '(no primary query)',
      updated: updated || '(none)',
      ageInDays: Number.isNaN(parsed)
        ? Number.POSITIVE_INFINITY
        : Math.floor((today.getTime() - parsed) / DAY),
    });
  }
  return pages.sort((a, b) => b.ageInDays - a.ageInDays);
}

export function stalePages(root: string, today: Date, days: number): PageAge[] {
  return pageAges(root, today).filter((page) => page.ageInDays >= days);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf('--days');
  const days = daysIndex >= 0 ? Number(args[daysIndex + 1]) : 90;
  if (!Number.isFinite(days) || days < 0) {
    console.error('--days takes a number of days');
    process.exit(2);
  }
  const root = path.resolve(__dirname, '..', 'docs', 'site');
  const today = new Date();
  const pages = args.includes('--all') ? pageAges(root, today) : stalePages(root, today, days);

  for (const page of pages) {
    const age = Number.isFinite(page.ageInDays) ? `${page.ageInDays}d` : 'no date';
    console.log(`${age.padStart(8)}  ${page.updated.padEnd(12)} ${page.file}`);
    console.log(`          query: ${page.primaryQuery}`);
  }
  const total = pageAges(root, today).length;
  console.log(
    args.includes('--all')
      ? `docs:staleness: ${total} page(s), oldest first`
      : `docs:staleness: ${pages.length} of ${total} page(s) have not been read against the code for ${days} days`,
  );
}
