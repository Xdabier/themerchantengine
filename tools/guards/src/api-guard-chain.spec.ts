import { expectNoViolations, readRepoFile, lineAt, Violation } from './lib/repo';

/**
 * Constitution 3.3: the global guard chain is what makes every `@Permissions`
 * and `@OwnerGuard()` decorator in the tree mean anything.
 *
 * `api-permissions` proves the decorators exist. A decorator is metadata;
 * without the guard that reads it, it is a comment. Delete the `PermissionsGuard`
 * provider, or move it above `SessionAuthGuard` so it reads `req.user` before
 * anything populates it, and all 305 routes keep their decorators, every other
 * guard stays green, and the entire admin surface is open.
 *
 * Restores the check the retired `permissions-auditor` made a blocker.
 */
const GUARD = 'api-guard-chain';

const APP_MODULE = 'apps/api/src/app.module.ts';

/** In order. The order is the rule: throttle before auth so an unauthenticated
 * flood is cheap, auth before permissions so `req.user` exists when the RBAC
 * guard reads it, permissions before the owner gate. */
const EXPECTED_CHAIN = [
  'AppThrottlerGuard',
  'SessionAuthGuard',
  'PermissionsGuard',
  'OwnerGuardGuard',
] as const;

export function readChain(source: string): Array<{ name: string; index: number }> {
  return [...source.matchAll(/provide:\s*APP_GUARD\s*,\s*useClass:\s*(\w+)/g)].map((match) => ({
    name: match[1],
    index: match.index,
  }));
}

export function check(source: string): Violation[] {
  const chain = readChain(source);
  const names = chain.map((entry) => entry.name);
  const violations: Violation[] = [];

  for (const expected of EXPECTED_CHAIN) {
    if (!names.includes(expected)) {
      violations.push({
        file: APP_MODULE,
        line: 1,
        message: `${expected} is not registered as an APP_GUARD. Its decorators across the tree become inert comments (constitution 3.3).`,
      });
    }
  }
  if (violations.length > 0) return violations;

  const positions = EXPECTED_CHAIN.map((name) => names.indexOf(name));
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] < positions[i - 1]) {
      violations.push({
        file: APP_MODULE,
        line: lineAt(source, chain[positions[i]].index),
        message: `${EXPECTED_CHAIN[i]} is registered before ${EXPECTED_CHAIN[i - 1]}. Nest applies APP_GUARD providers in declaration order, and this one needs what the earlier guard puts on the request (constitution 3.3).`,
      });
    }
  }
  return violations;
}

describe(GUARD, () => {
  const source = readRepoFile(APP_MODULE);

  it('registers the four global guards, in order', () => {
    expectNoViolations(check(source));
  });

  it('reads the module, so a missing file cannot pass as a clean chain', () => {
    expect(source).not.toBe('');
    expect(readChain(source)).toHaveLength(EXPECTED_CHAIN.length);
  });

  it('canary: turns red when a guard is dropped', () => {
    const stripped = source.replace(
      /provide:\s*APP_GUARD\s*,\s*useClass:\s*PermissionsGuard/,
      'provide: APP_GUARD, useClass: NothingGuard',
    );
    const messages = check(stripped).map((v) => v.message);
    expect(messages.some((m) => m.includes('PermissionsGuard is not registered'))).toBe(true);
  });

  it('canary: turns red when the chain is reordered', () => {
    const reordered = [
      '{ provide: APP_GUARD, useClass: AppThrottlerGuard },',
      '{ provide: APP_GUARD, useClass: PermissionsGuard },',
      '{ provide: APP_GUARD, useClass: SessionAuthGuard },',
      '{ provide: APP_GUARD, useClass: OwnerGuardGuard },',
    ].join('\n');
    const messages = check(reordered).map((v) => v.message);
    expect(
      messages.some((m) => m.includes('PermissionsGuard is registered before SessionAuthGuard')),
    ).toBe(true);
  });

  it('canary: turns red on an empty module', () => {
    expect(check('').length).toBe(EXPECTED_CHAIN.length);
  });
});
