import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the shared-session contract that `_auth-fixture.ts` relies on and
 * that nothing else enforced.
 *
 * `global-setup.ts` signs in once and writes one cookie pair; the fixture
 * replays that same pair into every browser context of every worker, so there
 * is exactly one server-side `Session` row behind the whole authenticated
 * suite. Better Auth sign-out deletes the row named by the presented cookie,
 * which means one spec clicking the topbar logout while holding the shared
 * cookie revokes the credential 62 other spec files depend on.
 *
 * That happened, and it took three and a half hours to attribute, because
 * `cookieCache.maxAge` is five minutes: the signed session-data cookie keeps
 * answering `getSession` from memory long after the row is gone, so the first
 * 401 lands minutes later in whichever file happened to be running then. The
 * symptom was 75 failures across two dozen files, most of them reported as
 * two-percent pixel drift on a visual baseline.
 *
 * This runs at the unit tier over the spec sources because that is the only
 * tier where the failure can name the culprit. At runtime the culprit and the
 * symptom are minutes and files apart.
 */

const MODULES_DIR = __dirname;
const SRC_DIR = resolve(__dirname, '..');

/** The one spec allowed to revoke a session: it signs in fresh on its own. */
const SIGN_OUT_OWNER = 'auth.journey.spec.ts';

interface SpecFile {
  name: string;
  path: string;
  source: string;
  /** Whitespace stripped, so a call split across lines still matches. */
  packed: string;
}

function readSpecs(dir: string): SpecFile[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => {
      const path = resolve(dir, entry.name);
      const source = readFileSync(path, 'utf8');
      return { name: entry.name, path, source, packed: source.replace(/\s+/g, '') };
    });
}

const ALL_SPECS = [...readSpecs(SRC_DIR), ...readSpecs(MODULES_DIR)];

function usesSharedFixture(spec: SpecFile): boolean {
  return /from\s+['"]\.\/_auth-fixture['"]/.test(spec.source);
}

/**
 * A *click* on the logout control, not a mention of it.
 * `shell-navigation.journey.spec.ts` deliberately asserts that control is
 * visible, as a regression guard against sign-out being moved inside a menu.
 * A predicate keyed on the string alone would go red on that guard, and the
 * natural way to make it green again would be to delete the guard.
 */
function clicksLogout(spec: SpecFile): boolean {
  return /topbar-logout.{0,40}?\.click\(/.test(spec.packed);
}

function callsSignOut(spec: SpecFile): boolean {
  return /\.signOut\(|auth\/sign-out/.test(spec.packed);
}

/** A password change deletes every session for the user (users.service.ts). */
function changesPassword(spec: SpecFile): boolean {
  return /newPassword/.test(spec.packed) && /users\/me|\.patch\(/.test(spec.packed);
}

test.describe('shared admin session contract', () => {
  test('the spec set is readable, so an empty glob cannot pass the rules below', () => {
    expect(ALL_SPECS.length).toBeGreaterThan(20);
    expect(ALL_SPECS.map((s) => s.name)).toContain(SIGN_OUT_OWNER);
    expect(ALL_SPECS.filter(usesSharedFixture).length).toBeGreaterThan(20);
  });

  test('exactly one spec clicks the logout control, and it is the one that owns that journey', () => {
    const clickers = ALL_SPECS.filter(clicksLogout)
      .map((s) => s.name)
      .sort();
    expect(clickers).toEqual([SIGN_OUT_OWNER]);
  });

  test('the spec that signs out holds its own session, never the shared one', () => {
    const owner = ALL_SPECS.find((s) => s.name === SIGN_OUT_OWNER);
    expect(owner, `${SIGN_OUT_OWNER} is missing`).toBeDefined();
    expect(
      usesSharedFixture(owner!),
      `${SIGN_OUT_OWNER} signs out, so it must not import ./_auth-fixture`,
    ).toBe(false);
    expect(
      /clearCookies\(\)/.test(owner!.packed),
      `${SIGN_OUT_OWNER} must clear cookies and sign in fresh before it revokes anything`,
    ).toBe(true);
  });

  test('no spec on the shared session revokes it', () => {
    const revokers = ALL_SPECS.filter(usesSharedFixture)
      .filter((spec) => clicksLogout(spec) || callsSignOut(spec) || changesPassword(spec))
      .map((s) => s.name)
      .sort();
    expect(
      revokers,
      'these specs import ./_auth-fixture and revoke the session it replays, which kills ' +
        'every later spec in the run. Sign in fresh on a plain @playwright/test context instead.',
    ).toEqual([]);
  });
});
