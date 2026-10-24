/**
 * The ninety-day refresh report, exercised on a planted tree so each rule is
 * seen failing before it is trusted: a stale page is listed, a fresh page is
 * not, a page with no date sorts first, and the real tree parses.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { pageAges, stalePages } from '../docs-staleness';

const TODAY = new Date('2026-09-09T00:00:00Z');

function plant(pages: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staleness-'));
  for (const [rel, body] of Object.entries(pages)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return root;
}

const page = (updated: string, extra = 'primaryQuery: how to install\n') =>
  `---\ntitle: A page\ndescription: d\n${extra}updated: ${updated}\nschema: TechArticle\n---\n\nBody.\n`;

describe('docs:staleness', () => {
  it('lists a page older than the window and leaves a fresh one alone', () => {
    const root = plant({
      'track/old.md': page('2026-01-01'),
      'track/fresh.md': page('2026-09-01'),
    });
    const stale = stalePages(root, TODAY, 90);
    expect(stale.map((p) => p.file)).toEqual(['track/old.md']);
    expect(stale[0].ageInDays).toBe(251);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a page whose frontmatter has no date, and sorts it first', () => {
    const root = plant({
      'track/dated.md': page('2026-01-01'),
      'track/undated.md': '---\ntitle: A page\ndescription: d\n---\n\nBody.\n',
    });
    const ages = pageAges(root, TODAY);
    expect(ages[0].file).toBe('track/undated.md');
    expect(ages[0].updated).toBe('(none)');
    expect(stalePages(root, TODAY, 90).map((p) => p.file)).toContain('track/undated.md');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('carries the primary query, which is what a refresh is judged against', () => {
    const root = plant({
      'track/old.md': page('2026-01-01', 'primaryQuery: ecommerce llms.txt\n'),
    });
    expect(stalePages(root, TODAY, 90)[0].primaryQuery).toBe('ecommerce llms.txt');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads an unquoted frontmatter date, which YAML hands back as a Date and not a string', () => {
    // The failure this covers: reading `updated` as a string only. Every page
    // in the tree writes the date unquoted, so that mistake made the whole
    // report answer "no date" for all of them and list nothing as stale.
    const root = plant({ 'track/page.md': page('2026-06-11') });
    const [only] = pageAges(root, TODAY);
    expect(only.updated).toBe('2026-06-11');
    expect(only.ageInDays).toBe(90);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads the date of a page checked out with CRLF line endings', () => {
    // Windows with core.autocrlf=true checks pages out as CRLF.
    const root = plant({ 'track/page.md': page('2026-06-11').replace(/\n/g, '\r\n') });
    const [only] = pageAges(root, TODAY);
    expect(only.updated).toBe('2026-06-11');
    expect(only.primaryQuery).toBe('how to install');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a page whose frontmatter is malformed rather than throwing on it', () => {
    const root = plant({
      'track/broken.md':
        '---\ntitle: A page\n  updated: "2026-01-01\n bad: [unclosed\n---\n\nBody.\n',
      'track/fine.md': page('2026-09-01'),
    });
    const ages = pageAges(root, TODAY);
    expect(ages.map((p) => p.file)).toContain('track/broken.md');
    expect(ages.find((p) => p.file === 'track/broken.md')?.updated).toBe('(none)');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports a page with no frontmatter block at all', () => {
    const root = plant({ 'track/bare.md': '# A page\n\nBody with no frontmatter.\n' });
    const [only] = pageAges(root, TODAY);
    expect(only.updated).toBe('(none)');
    expect(only.title).toBe('(no title)');
    expect(only.ageInDays).toBe(Number.POSITIVE_INFINITY);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('skips the tree README, which is a contributor note rather than a page', () => {
    const root = plant({ 'README.md': '# Rules\n', 'track/old.md': page('2026-01-01') });
    expect(pageAges(root, TODAY).map((p) => p.file)).toEqual(['track/old.md']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads the real documentation tree and finds a date on every page', () => {
    const root = path.resolve(__dirname, '..', '..', 'docs', 'site');
    const ages = pageAges(root, TODAY);
    expect(ages.length).toBeGreaterThan(100);
    const undated = ages.filter((p) => !Number.isFinite(p.ageInDays)).map((p) => p.file);
    expect(undated).toEqual([]);
  });
});
