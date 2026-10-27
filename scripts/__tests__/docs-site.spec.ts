/**
 * The rules docs/site/README.md states for a public documentation page, as a
 * spec, so a page that breaks one fails here rather than on the site build or,
 * worse, on the live site. The site repository validates the same frontmatter
 * and the "# " rule when it pulls; the internal-path, the record-reference and
 * the link rules live only here, because the engine is where the pages are
 * written.
 *
 * Every rule is exercised twice: on the real tree, which must be clean, and on
 * a planted page that carries exactly one defect, which must be reported.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { PAGE_MARKER } from '../docs-generate';

const REPO = path.resolve(__dirname, '..', '..');
const DOCS_SITE = path.join(REPO, 'docs', 'site');

const FRONTMATTER_FIELDS = ['title', 'description', 'primaryQuery', 'updated', 'schema'] as const;
const SCHEMAS = ['TechArticle', 'HowTo', 'FAQPage'];

/** Paths and names a public reader cannot open or should never meet. */
// `specs/` is anchored so the `product-specs/` route is not read as the planning directory.
const INTERNAL_PATHS = [/CLAUDE\.md/, /(?<![\w-])specs\//, /\bagent_docs\//, /\.claude\//];
/** A plan ticket, a phase, or a decision record named in a public page. */
const RECORD_REFERENCES = [
  /\b(?:plan|phase|ticket) [A-Z]{1,2}\d/,
  /\bDR-\d+\b/,
  /decision record/i,
];

/** The five headings of a recipe page, in the order a reader meets them. */
const RECIPE_HEADINGS = [
  'When you need this',
  'Files you touch',
  'The pattern',
  'Tests to run',
  'Gotchas',
];
/**
 * The five headings of a numbered flow page under build-a-storefront/
 * (`NN-*.md`), in the order a reader meets them. Other `## ` headings may sit
 * between or after them.
 */
const FLOW_HEADINGS = [
  'The request',
  'The response',
  'Error codes',
  'Every locale',
  'Framework notes',
];
const FLOW_PAGE = /^build-a-storefront\/\d{2}-[^/]+\.md$/;
/** The first line of every page `npm run docs:generate` writes, so a hand-written file under reference/ is refused; one literal, the generator's. */
const GENERATED_MARKER = PAGE_MARKER.replace(/^<!-- /, '').replace(/ -->$/, '');
/** An inline-code span that names a repository file. Only these roots are checked; a bare word is prose. */
const REPO_PATH =
  /^(?:apps|libs|tools|prisma|scripts|deploy|docs|test|\.github)\/|^(?:docker-compose\.yml|package\.json|nx\.json|tsconfig\.base\.json|setup\.sh|setup\.ps1|\.env\.example|\.env\.production\.example|\.nvmrc|\.gitattributes|CHANGELOG\.md|README\.md|LICENSE|NOTICE)$/;
/** A span with a glob, a placeholder, a brace or whitespace names a shape, not a file. */
const PATH_SHAPE = /[*<>{}\s]|\.\.\./;

const stripFences = (source: string): string =>
  source.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '');

/** The `## ` headings of a body, fences excluded, in order. */
function h2Headings(prose: string): string[] {
  const headings: string[] = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prose)) !== null) headings.push(match[1]);
  return headings;
}

/**
 * A path the installer or a run writes and git ignores (`deploy/engine/`,
 * `.env.production`) is a real path a page may name without it being in the
 * tree. A planted repository has no git and therefore ignores nothing.
 */
function gitIgnored(repo: string, repoPath: string): boolean {
  if (!fs.existsSync(path.join(repo, '.git'))) return false;
  return spawnSync('git', ['check-ignore', '-q', repoPath], { cwd: repo }).status === 0;
}

/** Every inline-code span of the prose (fences excluded) that names a repository path, with a `:line` suffix and a `#fragment` removed. */
function repoPaths(prose: string): string[] {
  const paths: string[] = [];
  const re = /`([^`\n]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prose)) !== null) {
    const span = match[1].replace(/:\d+(?:-\d+)?$/, '').replace(/#.*$/, '');
    if (REPO_PATH.test(span) && !PATH_SHAPE.test(span)) paths.push(span);
  }
  return paths;
}

/**
 * Parsed with the same YAML grammar the renderer uses (gray-matter is js-yaml
 * underneath), not by splitting on the first colon: an unquoted description
 * with a ": " inside is a YAML error on the site and passed a line splitter.
 */
function parseFrontmatter(
  source: string,
): { data: Record<string, unknown>; body: string } | { error: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return null;
  try {
    const data = yaml.load(match[1]);
    if (!data || typeof data !== 'object') return { error: 'frontmatter is not a mapping' };
    return { data: data as Record<string, unknown>, body: match[2] };
  } catch (err) {
    return { error: `frontmatter is not valid YAML (${(err as Error).message.split('\n')[0]})` };
  }
}

/** Every Markdown link target in the body, fences included: a link in a code sample is still a link a reader may follow. */
function linkTargets(body: string): string[] {
  const targets: string[] = [];
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) targets.push(match[1]);
  return targets;
}

/**
 * The violations of a docs/site tree, one line each; an empty list is a clean
 * tree. `repo` is the repository the tree documents, where every path a page
 * names must exist; it defaults to two directories up, which is where
 * docs/site sits.
 */
export function auditDocsSite(
  root: string,
  repo: string = path.resolve(root, '..', '..'),
): string[] {
  const violations: string[] = [];
  const metaFile = path.join(root, '_meta.json');
  if (!fs.existsSync(metaFile)) return [`${root}: _meta.json is missing`];
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { tracks?: string[] };
  const tracks = meta.tracks ?? [];

  const trackDirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name);
  for (const dir of trackDirs) {
    if (!tracks.includes(dir))
      violations.push(`${dir}/: a track directory _meta.json does not list`);
  }

  for (const track of tracks) {
    const dir = path.join(root, track);
    if (!fs.existsSync(dir)) continue;
    const sidebarFile = path.join(dir, '_sidebar.json');
    if (!fs.existsSync(sidebarFile)) {
      violations.push(`${track}/: no _sidebar.json`);
      continue;
    }
    const sidebar = JSON.parse(fs.readFileSync(sidebarFile, 'utf8')) as {
      title?: string;
      pages?: string[];
    };
    if (!sidebar.title) violations.push(`${track}/_sidebar.json: no title`);
    const listed = sidebar.pages ?? [];
    // Recursive, so a page under a nested directory (`recipes/api/add-endpoint`)
    // is validated and reported as an orphan like any other.
    const onDisk = fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) =>
        path
          .relative(dir, path.join(entry.parentPath ?? entry.path, entry.name))
          .split(path.sep)
          .join('/')
          .slice(0, -3),
      )
      .sort();
    for (const slug of listed) {
      if (!onDisk.includes(slug))
        violations.push(
          `${track}/_sidebar.json lists "${slug}" but ${track}/${slug}.md is not there`,
        );
    }
    for (const slug of onDisk) {
      if (!listed.includes(slug))
        violations.push(
          `${track}/${slug}.md is not in ${track}/_sidebar.json, so it is never rendered`,
        );
    }

    for (const slug of onDisk) {
      const file = path.join(dir, `${slug}.md`);
      const label = `${track}/${slug}.md`;
      const pageDir = path.dirname(file);
      const source = fs.readFileSync(file, 'utf8');
      const parsed = parseFrontmatter(source);
      if (!parsed) {
        violations.push(`${label}: no frontmatter`);
        continue;
      }
      if ('error' in parsed) {
        violations.push(`${label}: ${parsed.error}`);
        continue;
      }
      for (const field of FRONTMATTER_FIELDS) {
        if (!parsed.data[field]) violations.push(`${label}: frontmatter is missing "${field}"`);
      }
      // A bare 2026-09-08 is a Date to YAML; the renderer accepts either form.
      const updated = parsed.data.updated;
      const updatedText =
        updated instanceof Date ? updated.toISOString().slice(0, 10) : String(updated ?? '');
      if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updatedText)) {
        violations.push(`${label}: "updated" is "${updatedText}", not YYYY-MM-DD`);
      }
      if (parsed.data.schema && !SCHEMAS.includes(String(parsed.data.schema))) {
        violations.push(
          `${label}: "schema" is "${String(parsed.data.schema)}", not one of ${SCHEMAS.join(', ')}`,
        );
      }
      const prose = stripFences(parsed.body);
      if (/^#\s+/m.test(prose))
        violations.push(
          `${label}: the body carries an "# " heading; the title comes from the frontmatter`,
        );
      if (slug.startsWith('recipes/')) {
        const headings = h2Headings(prose);
        if (headings.join('|') !== RECIPE_HEADINGS.join('|')) {
          violations.push(
            `${label}: a recipe carries exactly the "## " headings ${RECIPE_HEADINGS.join(', ')} in that order; found ${headings.length ? headings.join(', ') : 'none'}`,
          );
        }
      }
      if (FLOW_PAGE.test(label)) {
        const headings = h2Headings(prose);
        // A missing heading is reported once and skipped; the order check only
        // compares the headings that are there.
        let previous: { name: string; at: number } | null = null;
        for (const heading of FLOW_HEADINGS) {
          const at = headings.indexOf(heading);
          if (at === -1) {
            violations.push(
              `${label}: a flow page carries the "## " heading "${heading}"; found ${headings.length ? headings.join(', ') : 'none'}`,
            );
          } else if (previous && at < previous.at) {
            violations.push(
              `${label}: the "## " heading "${heading}" comes before "${previous.name}"; a flow page carries ${FLOW_HEADINGS.join(', ')} in that order`,
            );
          } else {
            previous = { name: heading, at };
          }
        }
      }
      if (
        track === 'reference' &&
        !parsed.body.trimStart().startsWith(`<!-- ${GENERATED_MARKER} -->`)
      ) {
        violations.push(
          `${label}: a reference page is written by npm run docs:generate and must open with "<!-- ${GENERATED_MARKER} -->"`,
        );
      }
      for (const repoPath of repoPaths(prose)) {
        if (!fs.existsSync(path.join(repo, repoPath)) && !gitIgnored(repo, repoPath)) {
          violations.push(`${label}: names \`${repoPath}\`, which is not in the repository`);
        }
      }
      for (const pattern of INTERNAL_PATHS) {
        if (pattern.test(parsed.body))
          violations.push(`${label}: names an internal path (${pattern.source})`);
      }
      for (const pattern of RECORD_REFERENCES) {
        if (pattern.test(prose))
          violations.push(
            `${label}: refers to a plan, a phase or a decision record (${pattern.source})`,
          );
      }
      for (const target of linkTargets(parsed.body)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        if (target.startsWith('/')) {
          violations.push(
            `${label}: links to "${target}", an absolute path that breaks under a versioned URL; link the .md file instead`,
          );
          continue;
        }
        const [file, fragment] = target.split('#');
        if (!file.endsWith('.md')) {
          violations.push(
            `${label}: links to "${target}", which is not a .md file the renderer can resolve`,
          );
          continue;
        }
        const resolved = path.resolve(pageDir, file);
        if (!resolved.startsWith(root)) {
          violations.push(`${label}: links to "${target}", outside docs/site`);
        } else if (!fs.existsSync(resolved)) {
          violations.push(`${label}: links to "${target}", which does not exist`);
        } else if (fragment !== undefined && fragment === '') {
          violations.push(`${label}: links to "${target}" with an empty fragment`);
        }
      }
    }
  }

  // reference/ is written whole by the generator: every JSON file there, the
  // sidebar and the _generated/ inputs included, carries the marker as its
  // first key, and every other non-Markdown file (the HTTP file) carries it as
  // its first line, a `# ` comment, so a hand edit or a hand-written file
  // shows up here. The Markdown pages are checked with the tracks above.
  const reference = path.join(root, 'reference');
  if (fs.existsSync(reference)) {
    const files = fs
      .readdirSync(reference, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.endsWith('.md'))
      .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
    for (const file of files) {
      const label = `reference/${path.relative(reference, file).split(path.sep).join('/')}`;
      if (file.endsWith('.json')) {
        const firstKey = Object.keys(
          JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>,
        )[0];
        if (firstKey !== 'x-generated-by') {
          violations.push(
            `${label}: a reference file is written by npm run docs:generate and must open with a "x-generated-by" key`,
          );
        }
        continue;
      }
      const firstLine = fs.readFileSync(file, 'utf8').split(/\r?\n/, 1)[0];
      if (firstLine !== `# ${GENERATED_MARKER}`) {
        violations.push(
          `${label}: a reference file is written by npm run docs:generate and must open with "# ${GENERATED_MARKER}"`,
        );
      }
    }
  }
  return violations;
}

const CLEAN_PAGE = `---
title: A page
description: A page that follows every rule.
primaryQuery: a query
updated: 2026-09-08
schema: TechArticle
---

Body text.

## A heading

\`\`\`bash
# a comment in a fence is not a heading
echo ok
\`\`\`
`;

/** A clean page followed by one `## ` section per heading given, in that order. */
const withSections = (headings: string[]): string =>
  CLEAN_PAGE.replace('## A heading\n', '') +
  headings.map((heading) => `\n## ${heading}\n\nText.\n`).join('');
/** A clean page that opens with the generator's marker, as every reference page does. */
const MARKED_PAGE = CLEAN_PAGE.replace(
  '\nBody text.',
  `\n<!-- ${GENERATED_MARKER} -->\n\nBody text.`,
);
const RECIPE_PAGE = withSections(RECIPE_HEADINGS).replace(
  '## The pattern\n\nText.\n',
  '## The pattern\n\n### A sub-heading is fine\n\nText.\n',
);

/**
 * A fake repository holding a docs/site tree with one track and one clean
 * page, which a canary then breaks in one way. The repository has exactly one
 * source file, \`apps/real.ts\`, so the path rule has something to find.
 * Returns the docs/site root; the repository is two directories up, as in the
 * real tree.
 */
function plant(
  pages: Record<string, string>,
  sidebar: string[] = Object.keys(pages),
  track = 'track',
  extraFiles: Record<string, string> = {},
): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-'));
  fs.mkdirSync(path.join(repo, 'apps'));
  fs.writeFileSync(path.join(repo, 'apps', 'real.ts'), 'export {};\n');
  const root = path.join(repo, 'docs', 'site');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, '_meta.json'), JSON.stringify({ tracks: [track] }));
  fs.mkdirSync(path.join(root, track));
  // The reference sidebar is generated too, so it carries the marker key.
  const sidebarJson =
    track === 'reference'
      ? { 'x-generated-by': 'npm run docs:generate', title: 'Track', pages: sidebar }
      : { title: 'Track', pages: sidebar };
  fs.writeFileSync(path.join(root, track, '_sidebar.json'), JSON.stringify(sidebarJson));
  for (const [slug, body] of Object.entries(pages)) {
    const file = path.join(root, track, `${slug}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  for (const [relative, body] of Object.entries(extraFiles)) {
    const file = path.join(root, track, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  return root;
}

describe('docs/site', () => {
  it('follows every rule of docs/site/README.md', () => {
    expect(auditDocsSite(DOCS_SITE)).toEqual([]);
  });

  it('has at least one page per track the meta lists, or the rules protect nothing', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(DOCS_SITE, '_meta.json'), 'utf8')) as {
      tracks: string[];
    };
    const withPages = meta.tracks.filter((track) =>
      fs.existsSync(path.join(DOCS_SITE, track, '_sidebar.json')),
    );
    expect(withPages.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the rules fire on a planted defect', () => {
  const roots: string[] = [];
  const planted = (
    pages: Record<string, string>,
    sidebar?: string[],
    track?: string,
    extraFiles?: Record<string, string>,
  ) => {
    const root = plant(pages, sidebar, track, extraFiles);
    roots.push(path.resolve(root, '..', '..'));
    return auditDocsSite(root);
  };
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  it('a recipe with a heading missing, out of order, or one too many; a sub-heading is not counted', () => {
    expect(planted({ 'recipes/api/x': RECIPE_PAGE }, ['recipes/api/x'])).toEqual([]);
    const [a, b, c, d, e] = RECIPE_HEADINGS;
    for (const order of [
      [a, b, c, d],
      [a, b, c, e, d],
      [a, b, c, d, e, 'See also'],
    ]) {
      expect(planted({ 'recipes/api/x': withSections(order) }, ['recipes/api/x'])[0]).toMatch(
        /exactly the "## " headings/,
      );
    }
    // The rule is scoped to recipes: a conceptual page keeps its own headings.
    expect(planted({ conventions: RECIPE_PAGE.replace('## Gotchas', '## Anything') })).toEqual([]);
  });

  it('a flow page with a heading missing or out of order; another heading may sit between or after', () => {
    const [a, b, c, d, e] = FLOW_HEADINGS;
    const flow = (order: string[]) =>
      planted({ '01-config': withSections(order) }, ['01-config'], 'build-a-storefront');
    expect(flow([a, 'Overview', b, c, d, e, 'See also'])).toEqual([]);
    expect(flow([a, b, c, e])).toEqual([
      'build-a-storefront/01-config.md: a flow page carries the "## " heading "Every locale"; found The request, The response, Error codes, Framework notes',
    ]);
    expect(flow([a, b, d, c, e])).toEqual([
      'build-a-storefront/01-config.md: the "## " heading "Every locale" comes before "Error codes"; a flow page carries The request, The response, Error codes, Every locale, Framework notes in that order',
    ]);
    // The rule is scoped to the numbered pages of that track: the contract page
    // keeps its own headings, and a numbered page elsewhere is not a flow page.
    expect(planted({ index: CLEAN_PAGE }, ['index'], 'build-a-storefront')).toEqual([]);
    expect(planted({ '01-config': CLEAN_PAGE })).toEqual([]);
  });

  it('a repository path that is not there, but not a placeholder, a glob, a fence, or a bare word', () => {
    expect(
      planted({ page: `${CLEAN_PAGE}\nEdit \`apps/real.ts\` and \`apps/real.ts:12\`.\n` }),
    ).toEqual([]);
    expect(planted({ page: `${CLEAN_PAGE}\nEdit \`apps/gone.ts\`.\n` })).toEqual([
      'track/page.md: names `apps/gone.ts`, which is not in the repository',
    ]);
    expect(planted({ page: `${CLEAN_PAGE}\nEdit \`package.json\`.\n` })[0]).toMatch(
      /names `package\.json`/,
    );
    for (const span of [
      'apps/<name>/x.ts',
      'apps/**/*.spec.ts',
      'apps/api/src/modules/...',
      'apps/{a,b}',
      'apps and libs',
    ]) {
      expect(planted({ page: `${CLEAN_PAGE}\nSee \`${span}\`.\n` })).toEqual([]);
    }
    expect(
      planted({
        page: `${CLEAN_PAGE}\n\`\`\`ts\nimport x from 'apps/gone.ts'; // \`apps/gone.ts\`\n\`\`\`\n`,
      }),
    ).toEqual([]);
  });

  it('a reference page or JSON file the generator did not write', () => {
    const marked = MARKED_PAGE;
    const json = (first: string) =>
      JSON.stringify({ [first]: 'npm run docs:generate', title: 'Reference', pages: ['page'] });
    expect(
      planted({ page: marked }, ['page'], 'reference', {
        '_generated/a.json': json('x-generated-by'),
      }),
    ).toEqual([]);
    expect(planted({ page: CLEAN_PAGE }, ['page'], 'reference')[0]).toMatch(
      /must open with "<!-- generated by/,
    );
    expect(
      planted({ page: marked }, ['page'], 'reference', { '_generated/a.json': json('other') }),
    ).toEqual([
      'reference/_generated/a.json: a reference file is written by npm run docs:generate and must open with a "x-generated-by" key',
    ]);
    // The rule is scoped to reference/: the sidebar of any other track carries no marker.
    expect(planted({ page: marked })).toEqual([]);
  });

  it('a reference file of any other kind the generator did not write, the HTTP file included', () => {
    const http = (first: string) => `${first}\n\n### store config\nGET {{base}}/v1/store/config\n`;
    expect(
      planted({ page: MARKED_PAGE }, ['page'], 'reference', {
        '_generated/planted.http': http(`# ${GENERATED_MARKER}`),
      }),
    ).toEqual([]);
    expect(
      planted({ page: MARKED_PAGE }, ['page'], 'reference', {
        '_generated/planted.http': http('GET {{base}}/v1/store/config'),
      }),
    ).toEqual([
      `reference/_generated/planted.http: a reference file is written by npm run docs:generate and must open with "# ${GENERATED_MARKER}"`,
    ]);
  });

  it('stays quiet on a clean page', () => {
    expect(planted({ page: CLEAN_PAGE })).toEqual([]);
  });

  it('a missing frontmatter field', () => {
    expect(planted({ page: CLEAN_PAGE.replace('primaryQuery: a query\n', '') })).toEqual([
      'track/page.md: frontmatter is missing "primaryQuery"',
    ]);
  });

  it('a description with an unquoted ": " inside, which is a YAML error on the site', () => {
    const page = CLEAN_PAGE.replace(
      'description: A page that follows every rule.',
      'description: What you need: the box, the keys.',
    );
    expect(planted({ page })[0]).toMatch(/not valid YAML/);
    const quoted = CLEAN_PAGE.replace(
      'description: A page that follows every rule.',
      'description: "What you need: the box, the keys."',
    );
    expect(planted({ page: quoted })).toEqual([]);
  });

  it('a date that is not YYYY-MM-DD', () => {
    expect(planted({ page: CLEAN_PAGE.replace('2026-09-08', 'September 2026') })[0]).toMatch(
      /not YYYY-MM-DD/,
    );
  });

  it('an unknown schema', () => {
    expect(planted({ page: CLEAN_PAGE.replace('TechArticle', 'Article') })[0]).toMatch(
      /"schema" is "Article"/,
    );
  });

  it('an authored "# " heading, but not a "#" comment inside a fence', () => {
    expect(planted({ page: `${CLEAN_PAGE}\n# Authored\n` })[0]).toMatch(/"# " heading/);
    expect(
      planted({ page: CLEAN_PAGE.replace('```bash', '~~~sh').replace('```\n', '~~~\n') }),
    ).toEqual([]);
  });

  it('a sidebar entry with no file, and a file no sidebar lists, nested included', () => {
    expect(planted({ page: CLEAN_PAGE }, ['page', 'ghost'])[0]).toMatch(/lists "ghost"/);
    expect(planted({ page: CLEAN_PAGE, orphan: CLEAN_PAGE }, ['page'])[0]).toMatch(
      /orphan\.md is not in/,
    );
    expect(planted({ page: CLEAN_PAGE, 'guides/api/orphan': CLEAN_PAGE }, ['page'])[0]).toMatch(
      /guides\/api\/orphan\.md is not in/,
    );
    expect(
      planted({ page: CLEAN_PAGE, 'guides/api/nested': `${CLEAN_PAGE}\n[up](../../page.md)\n` }, [
        'page',
        'guides/api/nested',
      ]),
    ).toEqual([]);
  });

  it('an internal path a public reader cannot open', () => {
    for (const text of [
      'see CLAUDE.md',
      'see specs/constitution.md',
      'see agent_docs/testing.md',
      'see .claude/commands',
    ]) {
      expect(planted({ page: `${CLEAN_PAGE}\n${text}\n` })[0]).toMatch(/internal path/);
    }
    // A route segment that ends in "specs" is not the planning directory.
    expect(planted({ page: `${CLEAN_PAGE}\nGET /v1/admin/product-specs/x\n` })).toEqual([]);
  });

  it('a plan ticket, a phase or a decision record', () => {
    for (const text of [
      'as plan E4.3 says',
      'landed in phase L2',
      'recorded as DR-31',
      'the decision record explains',
    ]) {
      expect(planted({ page: `${CLEAN_PAGE}\n${text}\n` })[0]).toMatch(
        /plan, a phase or a decision record/,
      );
    }
    // The license "plan" tier is a word a page may use.
    expect(planted({ page: `${CLEAN_PAGE}\nthe plan named in the license file\n` })).toEqual([]);
  });

  it('a link to a page that does not exist, an absolute link, and a link with no .md', () => {
    expect(planted({ page: `${CLEAN_PAGE}\n[x](./missing.md)\n` })[0]).toMatch(/does not exist/);
    expect(planted({ page: `${CLEAN_PAGE}\n[x](/docs/track/page/)\n` })[0]).toMatch(
      /absolute path/,
    );
    expect(planted({ page: `${CLEAN_PAGE}\n[x](../track/page/)\n` })[0]).toMatch(/not a \.md file/);
    expect(
      planted({
        page: `${CLEAN_PAGE}\n[x](../track/page.md#a-heading) [y](https://example.com) [z](#a-heading)\n`,
      }),
    ).toEqual([]);
  });
});
