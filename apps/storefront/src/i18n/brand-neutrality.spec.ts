import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadStoreConfigFixture, STORE_CONFIG_FIXTURE_IDS } from '@common/store-config-fixtures';

import ar from './ar';
import en from './en';
import fr from './fr';
import type { ChromeStrings } from './types';

/**
 * The catalogues carry no store's identity, and the leaves that render one
 * carry a placeholder for it (plan E2.5.1, E2.6 gate B).
 *
 * Gate A recorded why this file exists: `i18n.spec.ts` guards key shape and
 * Arabic-script isolation, so eighty-five leaves naming the previous client
 * were green in CI the whole time. Both halves below are asserted, because a
 * negative-only rule passes the moment someone deletes the copy instead of
 * parameterising it.
 */

const CATALOGUES: Record<string, ChromeStrings> = { fr, en, ar };

/**
 * The repo-root guard's token table, read from the JSON file the guard reads
 * rather than restated. A token added there must fail this spec too, and a
 * copy of the list here would drift the first time one is. The table lives in
 * its own repository-only file so the guard can ship in a release archive
 * without naming the clients. A release tarball has no table, so the two
 * tests that read it skip there; in the repository a missing table still
 * fails scripts/__tests__/verify-no-client-refs.spec.ts.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const TOKEN_TABLE = join(REPO_ROOT, 'scripts', 'verify-no-client-refs.tokens.json');

function clientTokens(): { name: string; pattern: RegExp }[] {
  const raw = JSON.parse(readFileSync(TOKEN_TABLE, 'utf8')) as {
    tokens: { name: string; source: string; flags: string }[];
  };
  return raw.tokens.map((t) => ({ name: t.name, pattern: new RegExp(t.source, t.flags) }));
}

/**
 * Leaves that name the store or its market, and so must be parameterised.
 *
 * Not every leaf that could take a placeholder: only the ones where a literal
 * would be one install's copy shipped to every other install.
 */
const IDENTITY_LEAVES: { path: string; placeholder: '{store}' | '{country}' }[] = [
  { path: 'meta.title', placeholder: '{store}' },
  { path: 'brand.name', placeholder: '{store}' },
  { path: 'splash.subheading', placeholder: '{store}' },
  { path: 'header.brandLockupAlt', placeholder: '{store}' },
  { path: 'footer.copyright', placeholder: '{store}' },
  { path: 'footer.brandLockupAlt', placeholder: '{store}' },
  { path: 'footer.socialLinkLabel', placeholder: '{store}' },
  { path: 'newsletter.blurb', placeholder: '{store}' },
  { path: 'home.trust.heading', placeholder: '{store}' },
  { path: 'account.addresses.form.countryHint', placeholder: '{country}' },
  { path: 'account.addresses.form.countryDefault', placeholder: '{country}' },
  { path: 'checkout.steps.address.fields.countryHint', placeholder: '{country}' },
];

describe('chrome catalogues are brand neutral', () => {
  it.skipIf(!existsSync(TOKEN_TABLE))('reads the repo guard token table', () => {
    const tokens = clientTokens();
    // Every token the table declares is parsed, and none of them is named
    // here: this file is inside the tree the guard scans, so a token spelled
    // out as an expectation would be the very reference it forbids.
    const declared = (JSON.parse(readFileSync(TOKEN_TABLE, 'utf8')) as { tokens: unknown[] }).tokens
      .length;
    expect(tokens).toHaveLength(declared);
    expect(tokens.length).toBeGreaterThan(3);
    for (const token of tokens) expect(token.pattern).toBeInstanceOf(RegExp);
  });

  it.skipIf(!existsSync(TOKEN_TABLE))('names no client, market or currency in any leaf', () => {
    const tokens = clientTokens();
    const offenders: string[] = [];
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const [path, leaf] of walk(catalogue)) {
        for (const token of tokens) {
          if (token.pattern.test(leaf))
            offenders.push(`${locale}.${path} [${token.name}]: ${leaf}`);
        }
      }
    }
    expect(
      offenders,
      `client references in the chrome catalogues:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('parameterises every leaf that renders the store or its market', () => {
    const offenders: string[] = [];
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const leaves = new Map(walk(catalogue));
      for (const { path, placeholder } of IDENTITY_LEAVES) {
        const leaf = leaves.get(path);
        if (leaf === undefined) {
          offenders.push(`${locale}.${path} is missing from the catalogue`);
        } else if (!leaf.includes(placeholder)) {
          offenders.push(`${locale}.${path} does not carry ${placeholder}: ${leaf}`);
        }
      }
    }
    expect(offenders, `unparameterised identity copy:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('names no currency in any leaf', () => {
    // Money is rendered from `money` in the runtime config, never spelled into
    // copy: the catalogue price bands read "Under 50 DT" for a whole phase
    // after the formatter became config-driven, so every install advertised one
    // retired store's unit whatever it actually charged in. The client-token
    // scan above could not see it, because a currency symbol is not a client
    // name (plan E2.5).
    const units = new Set<string>();
    for (const id of STORE_CONFIG_FIXTURE_IDS) {
      const money = loadStoreConfigFixture(id).money;
      units.add(money.currencyCode);
      units.add(money.symbol);
    }
    const offenders: string[] = [];
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      for (const [path, leaf] of walk(catalogue)) {
        for (const unit of units) {
          // Word-bounded for the alphabetic codes so `LD` does not match inside
          // an ordinary word; the symbols are matched as written.
          const found = /^[A-Za-z]+$/.test(unit)
            ? new RegExp(`(?<![A-Za-z])${unit}(?![A-Za-z])`).test(leaf)
            : leaf.includes(unit);
          if (found) offenders.push(`${locale}.${path} [${unit}]: ${leaf}`);
        }
      }
    }
    expect(offenders, `currency spelled into the chrome copy:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('parameterises the price bands rather than stating an amount with a unit', () => {
    const bands = [
      { path: 'catalog.filters.priceUnder50', tokens: ['{max}'] },
      { path: 'catalog.filters.price50to250', tokens: ['{min}', '{max}'] },
      { path: 'catalog.filters.price250to1000', tokens: ['{min}', '{max}'] },
      { path: 'catalog.filters.priceOver1000', tokens: ['{min}'] },
    ];
    const offenders: string[] = [];
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const leaves = new Map(walk(catalogue));
      for (const { path, tokens } of bands) {
        const leaf = leaves.get(path);
        if (leaf === undefined) {
          offenders.push(`${locale}.${path} is missing from the catalogue`);
          continue;
        }
        for (const token of tokens) {
          if (!leaf.includes(token)) offenders.push(`${locale}.${path} lacks ${token}: ${leaf}`);
        }
      }
    }
    expect(offenders, `unparameterised price bands:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the identity-leaf list pointing at leaves that exist', () => {
    // A path renamed out from under this list would silently stop being
    // guarded, which is how the previous guard passed for a whole phase.
    const leaves = new Map(walk(en));
    for (const { path } of IDENTITY_LEAVES) {
      expect(leaves.has(path), `${path} is no longer a leaf of ChromeStrings`).toBe(true);
    }
  });
});

/**
 * The chrome copy a component reads is resolved against the store's identity.
 *
 * `getChromeStrings(locale)` with no identity resolves against the neutral
 * config, which is right for a caller that has none and wrong for a caller
 * that renders the store. Every single-argument call site is listed here with
 * the branch it reads, and the branch must carry no placeholder.
 */
const SINGLE_ARG_CALLERS = new Map<string, string>([
  ['app/ui/pagination.component.ts', 'generic'],
  ['app/ui/price.component.ts', 'generic'],
  ['app/ui/product-card.component.ts', 'product.stock'],
  ['app/ui/rating.component.ts', 'generic.ratingSummary'],
]);

describe('identity-free chrome reads', () => {
  it('lists every single-argument getChromeStrings call site and the branch it reads', () => {
    const found = new Map<string, string>();
    for (const [file, source] of sourceFiles()) {
      for (const match of source.matchAll(/getChromeStrings\(/g)) {
        // Read to the balanced closing paren, not to the first one: a call
        // whose only argument is itself a call, `getChromeStrings(locale())`,
        // ends three characters early to a line-scoped reader and every
        // two-argument site then reads as a one-argument site.
        const open = (match.index ?? 0) + match[0].length - 1;
        if (splitsOnComma(readCall(source, open))) continue;
        found.set(file, readBranch(source, closingParen(source, open)));
      }
    }
    // The branch is parsed out of the source, not restated: a call site that
    // starts reading the store's name must move this list, or the assertion
    // below is checking a branch the file no longer reads.
    expect(Object.fromEntries([...found].sort())).toEqual(
      Object.fromEntries([...SINGLE_ARG_CALLERS].sort()),
    );
  });

  it('reads only branches no identity placeholder reaches', () => {
    const offenders: string[] = [];
    for (const [file, branch] of SINGLE_ARG_CALLERS) {
      for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
        for (const [path, leaf] of walk(catalogue)) {
          if (path !== branch && !path.startsWith(`${branch}.`)) continue;
          if (/\{(store|country)\}/.test(leaf)) {
            offenders.push(`${file} reads ${locale}.${path}, which carries a placeholder: ${leaf}`);
          }
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

/** Index of the paren that closes the one at `open`. */
function closingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return source.length - 1;
}

/**
 * The catalogue branch a call site reads, from the property chain that follows
 * the call. Stops at the first segment that is called, so the `.replace` of a
 * placeholder interpolation is not read as part of the branch.
 */
function readBranch(source: string, close: number): string {
  const segments: string[] = [];
  let i = close + 1;
  for (;;) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== '.') break;
    i++;
    const start = i;
    while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++;
    if (i === start) break;
    const segment = source.slice(start, i);
    let probe = i;
    while (probe < source.length && /\s/.test(source[probe])) probe++;
    if (source[probe] === '(') break;
    segments.push(segment);
  }
  return segments.join('.');
}

/** The argument list of a call whose opening paren is at `open`, paren-balanced. */
function readCall(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

function splitsOnComma(args: string): boolean {
  let depth = 0;
  for (const ch of args) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

/** Every non-spec source file of the app, excluding the i18n layer itself. */
function sourceFiles(): [string, string][] {
  const root = join(__dirname, '..');
  const out: [string, string][] = [];
  const walkDir = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'i18n') walkDir(full);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
        const rel = full.slice(root.length + 1).replace(/\\/g, '/');
        out.push([rel, readFileSync(full, 'utf8')]);
      }
    }
  };
  walkDir(root);
  return out;
}

function walk(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    walk(child, prefix ? `${prefix}.${key}` : key),
  );
}
