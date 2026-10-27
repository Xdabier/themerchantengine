import { PERMISSION_MODULES } from '@permissions';

import { expectNoViolations, readCanary, readTree, SourceFile, Violation } from './lib/repo';
import {
  Route,
  decoratorArgumentOf,
  hasRouteDecorator,
  isWrite,
  readRoutes,
} from './lib/controllers';

/**
 * Constitution 3.3: every admin route is permission-gated, every per-customer
 * storefront write is owner-gated or explicitly public.
 *
 * Replaces the retired `permissions-auditor`. The catalogue drift guards in
 * `apps/api/src/permission-key-drift.spec.ts` already check that a declared key
 * exists on both sides; this one checks that a route declares one at all.
 */
const GUARD = 'api-permissions';

const ADMIN_PATH = /(^|\/)admin(\/|$)/;

const PERMISSION_KEY = /^['"](\w+):(\w+)['"]$/;

/** The decorators that declare an access stance for a storefront route.
 * `OptionalAuth` and `RequireAuth` are stances, not gaps: the cart and guest
 * checkout are anonymous-capable by design and scope on the session cookie or
 * `req.user.id` inside the service. What the guard forbids is a write with no
 * stance at all, which is what `PermissionsGuard` reads as "any authenticated
 * user" and which is how a customer session reaches somebody else's row. */
const ACCESS_DECORATORS = ['Public', 'OwnerGuard', 'OptionalAuth', 'RequireAuth', 'Permissions'];

/** Per-customer storefront surfaces. A GET here returns one customer's data,
 * so it needs a declared stance just as a write does: constitution 3.3 names
 * orders, carts, wishlists, reviews, addresses, saved payment methods, returns
 * and gift-card redemption. Kept as an explicit list rather than "every GET",
 * because most storefront reads are catalogue pages that are public by
 * design. */
const PER_CUSTOMER_SEGMENTS =
  /(^|\/)(?:orders|cart|wishlist|returns|addresses|payment-methods|gift-cards|me)(\/|$)/;

/** An admin route may go without `@Permissions` only where a decision record
 * says so, and only when the waiver names the handler as its first token.
 * Anchoring matters: the rest of the line is English prose, and an unanchored
 * match would let "the list and update routes stay gated" waive handlers
 * called `list` and `update` in the same file. DR-26's store-currency route is
 * the one case in the tree today. */
function isWaived(route: Route, sources: ReadonlyMap<string, string>): boolean {
  const text = sources.get(route.file) ?? '';
  return new RegExp(String.raw`permissions-waived:\s*${route.handler}\b`).test(text);
}

export function check(routes: readonly Route[], sources: ReadonlyMap<string, string>): Violation[] {
  const violations: Violation[] = [];
  const modules = new Set<string>(PERMISSION_MODULES as readonly string[]);

  for (const route of routes) {
    if (route.path.endsWith('<unresolved>')) {
      violations.push({
        file: route.file,
        line: route.line,
        message: `${route.controller}.${route.handler}: the route path is an expression this guard cannot resolve. Use a string literal or an ADMIN_API_ROUTES reference so the route stays auditable.`,
      });
      continue;
    }

    if (ADMIN_PATH.test(route.path)) {
      const permissions = decoratorArgumentOf(route, 'Permissions');
      if (permissions === undefined) {
        if (isWaived(route, sources)) continue;
        violations.push({
          file: route.file,
          line: route.line,
          message: `${route.verb} /${route.path} is an admin route with no @Permissions (constitution 3.3). Gate it, or record a decision and add a "permissions-waived: <handler> - <reason>" comment.`,
        });
        continue;
      }
      for (const key of permissions
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)) {
        const parsed = PERMISSION_KEY.exec(key);
        if (!parsed) {
          violations.push({
            file: route.file,
            line: route.line,
            message: `${route.verb} /${route.path}: @Permissions argument ${key} is not a literal "<module>:<action>" key.`,
          });
        } else if (!modules.has(parsed[1])) {
          violations.push({
            file: route.file,
            line: route.line,
            message: `${route.verb} /${route.path}: permission module "${parsed[1]}" is not in PERMISSION_MODULES.`,
          });
        }
      }
      continue;
    }

    // Storefront lane. A write with no declared stance is the shape that let
    // one customer act on another customer's row. A per-customer read is the
    // same shape with a different verb: it discloses instead of mutating.
    const perCustomerRead = !isWrite(route) && PER_CUSTOMER_SEGMENTS.test(route.path);
    if (!isWrite(route) && !perCustomerRead) continue;
    if (ACCESS_DECORATORS.some((name) => hasRouteDecorator(route, name))) continue;
    violations.push({
      file: route.file,
      line: route.line,
      message: `${route.verb} /${route.path} is a storefront ${isWrite(route) ? 'write' : 'per-customer read'} with no access decorator. Declare one of ${ACCESS_DECORATORS.join(', ')} (constitution 3.3).`,
    });
  }
  return violations;
}

function sourcesOf(files: readonly SourceFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.path, file.text]));
}

describe(GUARD, () => {
  const apiFiles = readTree({ dirs: ['apps/api/src'], extensions: ['.controller.ts'] });

  it('finds every admin route permission-gated and every storefront write scoped', () => {
    expectNoViolations(check(readRoutes(apiFiles), sourcesOf(apiFiles)));
  });

  it('parses every HTTP decorator in the tree, so a partial parser regression is loud', () => {
    // Parity against a raw count, not a magic floor: `> 200` would have let a
    // third of the route surface disappear silently.
    const raw = apiFiles.reduce(
      (total, file) =>
        total +
        (file.text.match(/^\s*@(?:Get|Post|Patch|Put|Delete|All|Head|Options)\(/gm)?.length ?? 0),
      0,
    );
    expect(raw).toBeGreaterThan(250);
    expect(readRoutes(apiFiles)).toHaveLength(raw);
  });

  it('canary: an unresolvable controller base is reported, not silently downgraded', () => {
    const file = {
      path: 'apps/api/src/modules/x/x.controller.ts',
      text: [
        "@Controller({ path: ADMIN_API_ROUTES.orders.base, version: '1' })",
        'export class XController {',
        "  @Get(':id')",
        '  find() {}',
        '}',
      ].join(String.fromCharCode(10)),
    };
    const messages = check(readRoutes([file]), sourcesOf([file])).map((v) => v.message);
    expect(messages.some((m) => m.includes('cannot resolve'))).toBe(true);
  });

  it('canary: a waiver only covers the handler it names first', () => {
    const file = {
      path: 'apps/api/src/modules/y/y.controller.ts',
      text: [
        '// permissions-waived: getStore - the list and update routes stay gated.',
        "@Controller('v1')",
        'export class YController {',
        "  @Get('admin/store')",
        '  getStore() {}',
        "  @Get('admin/list')",
        '  list() {}',
        '}',
      ].join(String.fromCharCode(10)),
    };
    const messages = check(readRoutes([file]), sourcesOf([file])).map((v) => v.message);
    expect(messages.some((m) => m.includes('/v1/admin/list'))).toBe(true);
    expect(messages.some((m) => m.includes('/v1/admin/store'))).toBe(false);
  });

  it('canary: the guard turns red on an ungated admin route and an ungated storefront write', () => {
    const canary = readCanary(GUARD);
    const messages = check(readRoutes(canary), sourcesOf(canary)).map((v) => v.message);
    expect(messages.some((m) => m.includes('admin route with no @Permissions'))).toBe(true);
    expect(messages.some((m) => m.includes('storefront write with no access decorator'))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes('is not in PERMISSION_MODULES'))).toBe(true);
  });

  it('canary: a gated admin route, a waived one and a declared storefront write stay green', () => {
    const allowed = readCanary(GUARD).filter((f) => f.path.includes('allowed'));
    expect(allowed.length).toBeGreaterThan(0);
    expect(check(readRoutes(allowed), sourcesOf(allowed))).toEqual([]);
  });
});
