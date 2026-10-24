import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Components consume the semantic tokens, never the palette and never a hex.
 *
 * That is the rule constitution §3.9 states and `agent_docs/admin/brand-tokens.md`
 * spells out, and it is the whole reason light mode is possible: a component
 * that names Void Black has decided what colour it is in every mode, and no
 * mapping can undo that decision later. The rule is only real if something
 * fails when it is broken, and a colour that is wrong in one of two modes is
 * exactly the kind of defect a screenshot in the other mode reports as green.
 *
 * The palette is declared in two files and referenced nowhere else. Those two
 * are exempt, along with the one documented out-of-CSS hex: `index.html`'s
 * `theme-color` meta, which is platform metadata and cannot read a variable.
 */

const workspaceRoot = join(__dirname, '..', '..', '..');
const TREES = [join('apps', 'admin', 'src'), join('libs', 'admin-ui', 'src')];
const EXTENSIONS = ['.ts', '.html', '.css'];

const EXEMPT = new Set(
  [
    // Declares the palette and maps the semantic layer onto it.
    join('apps', 'admin', 'src', 'styles.css'),
    // Asserts on the declarations themselves.
    join('apps', 'admin', 'src', 'brand-tokens.spec.ts'),
    // This file names every token it forbids.
    join('apps', 'admin', 'src', 'palette-token.guard.spec.ts'),
    // The `theme-color` meta, documented in agent_docs/admin/brand-tokens.md.
    join('apps', 'admin', 'src', 'index.html'),
    // The brand settings screen edits the STORE's colours, not the admin's, so
    // its spec has to name hex values to exercise the palette generator. The
    // page itself is deliberately NOT exempt: it reads the engine's default
    // colour from the shared config rather than carrying one.
    join('apps', 'admin', 'src', 'app', 'features', 'settings', 'settings-brand.page.spec.ts'),
  ].map((p) => p.split('/').join(sep)),
);

/**
 * Derived from the stylesheet, not hand-listed.
 *
 * A hand-maintained list is one a new colour is added without: `engine-accent`
 * was a palette colour three components referenced directly for weeks, and the
 * omission is exactly why nothing caught them. Reading the declarations means
 * a colour is guarded from the moment it exists.
 *
 * Names the semantic layer also declares are excluded, because they are not
 * the same name meaning two things: `--color-status-error` is the palette hex
 * and `--status-error` is what components consume, and a substring search for
 * one finds the other.
 */
const PALETTE = (() => {
  const styles = readFileSync(join(workspaceRoot, 'apps', 'admin', 'src', 'styles.css'), 'utf8');
  // The config too, not only the stylesheet: a colour declared there alone is
  // all it takes for `bg-something` to resolve, and that is the same opening
  // `engine-accent` slipped through.
  const config = readFileSync(join(workspaceRoot, 'apps', 'admin', 'tailwind.config.js'), 'utf8');
  const palette = [
    ...[...styles.matchAll(/--color-([\w-]+)\s*:/g)].map(([, name]) => name),
    ...[...config.matchAll(/'([a-z][\w-]*)':\s*'#[0-9a-fA-F]{3,8}'/g)].map(([, name]) => name),
  ];
  const semantic = new Set(
    [...styles.matchAll(/^\s+--([\w-]+)\s*:/gm)]
      .map(([, name]) => name)
      .filter((name) => !name.startsWith('color-')),
  );
  return [...new Set(palette)].filter((name) => !semantic.has(name));
})();

const HEX = /#[0-9a-fA-F]{3,8}\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

const sources = TREES.flatMap((tree) => walk(join(workspaceRoot, tree)))
  .map((file) => relative(workspaceRoot, file))
  .filter((file) => !EXEMPT.has(file));

describe('admin palette-token guard', () => {
  it('finds the trees it is supposed to be guarding', () => {
    // A walk that silently returns nothing would report green forever.
    expect(sources.length).toBeGreaterThan(200);
  });

  it.each(PALETTE)('no component references the %s palette token', (token) => {
    const offenders = sources.filter((file) =>
      readFileSync(join(workspaceRoot, file), 'utf8').includes(token),
    );
    expect(offenders).toEqual([]);
  });

  it('no component hardcodes a hex colour', () => {
    const offenders = sources
      .map((file) => {
        const match = HEX.exec(readFileSync(join(workspaceRoot, file), 'utf8'));
        return match ? `${file}: ${match[0]}` : null;
      })
      .filter((entry): entry is string => entry !== null);
    expect(offenders).toEqual([]);
  });
});
