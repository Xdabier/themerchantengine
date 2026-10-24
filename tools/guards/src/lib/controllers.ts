import { ADMIN_API_ROUTES } from '@admin-routes';

import { readTree, SourceFile } from './repo';
import {
  ClassMember,
  ParsedClass,
  decoratorArgument,
  decoratorName,
  parseClasses,
} from './ts-class';

export const HTTP_DECORATORS = [
  'Get',
  'Post',
  'Patch',
  'Put',
  'Delete',
  'All',
  'Head',
  'Options',
] as const;

export type HttpVerb = (typeof HTTP_DECORATORS)[number];

export interface Route {
  readonly file: string;
  readonly line: number;
  readonly controller: string;
  readonly handler: string;
  readonly verb: HttpVerb;
  /** Full route path, with the controller base joined on. */
  readonly path: string;
  /** Decorators on the handler plus the ones inherited from the controller. */
  readonly decorators: readonly string[];
  readonly memberDecorators: readonly string[];
  /** Handler declaration plus parameter list, where `@Body()`, `@Query()` and
   * `@IdempotencyKey()` live. */
  readonly signature: string;
}

const WRITE_VERBS: ReadonlySet<string> = new Set(['Post', 'Patch', 'Put', 'Delete']);

export function isWrite(route: Route): boolean {
  return WRITE_VERBS.has(route.verb);
}

/** Resolve a route-decorator argument to a path string.
 *
 * Handles the two forms the controllers use: a string literal, and a dotted
 * reference into `ADMIN_API_ROUTES`. An unresolvable expression returns
 * undefined so a guard reports it rather than silently treating the route as
 * unrouted. */
export function resolvePath(argument: string | undefined): string | undefined {
  if (argument === undefined) return '';
  const literal = /^['"`]([^'"`]*)['"`]$/.exec(argument.trim());
  if (literal) return literal[1];
  const reference = /^ADMIN_API_ROUTES((?:\.\w+)+)$/.exec(argument.trim());
  if (reference) {
    let node: unknown = ADMIN_API_ROUTES;
    for (const key of reference[1].slice(1).split('.')) {
      if (typeof node !== 'object' || node === null) return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return typeof node === 'string' ? node : undefined;
  }
  return undefined;
}

function joinPath(base: string, sub: string): string {
  const trimmedBase = base.replace(/^\/|\/$/g, '');
  const trimmedSub = sub.replace(/^\/|\/$/g, '');
  if (!trimmedSub) return trimmedBase;
  if (!trimmedBase) return trimmedSub;
  return `${trimmedBase}/${trimmedSub}`;
}

function routesOfClass(file: SourceFile, parsed: ParsedClass): Route[] {
  const controllerDecorator = parsed.decorators.find((d) => decoratorName(d) === 'Controller');
  if (!controllerDecorator) return [];
  // An unresolvable base must propagate, never default to ''. Twenty-four
  // admin modules carry `admin/` in the controller base, so losing it would
  // reclassify the whole controller as storefront and skip the RBAC check in
  // silence. The method-path case is already reported this way.
  const resolvedBase = resolvePath(decoratorArgument(controllerDecorator));
  const base = resolvedBase ?? '<unresolved>';

  const routes: Route[] = [];
  for (const member of parsed.members) {
    for (const decorator of member.decorators) {
      const name = decoratorName(decorator) as HttpVerb;
      if (!HTTP_DECORATORS.includes(name)) continue;
      const sub = resolvePath(decoratorArgument(decorator));
      routes.push({
        file: file.path,
        line: member.line,
        controller: parsed.name,
        handler: member.name,
        verb: name,
        path:
          resolvedBase === undefined || sub === undefined
            ? `${base}/<unresolved>`
            : joinPath(base, sub),
        decorators: [...member.decorators, ...parsed.decorators],
        memberDecorators: member.decorators,
        signature: member.signature,
      });
    }
  }
  return routes;
}

/** Every route the API declares, read from the controller files. */
export function readRoutes(files: readonly SourceFile[]): Route[] {
  const routes: Route[] = [];
  for (const file of files) {
    if (!file.path.endsWith('.controller.ts')) continue;
    for (const parsed of parseClasses(file)) {
      routes.push(...routesOfClass(file, parsed));
    }
  }
  return routes;
}

export function readApiRoutes(): Route[] {
  return readRoutes(readTree({ dirs: ['apps/api/src'], extensions: ['.controller.ts'] }));
}

export function hasRouteDecorator(route: Route, name: string): boolean {
  return route.decorators.some((d) => decoratorName(d) === name);
}

export function routeDecorator(route: Route, name: string): string | undefined {
  return route.decorators.find((d) => decoratorName(d) === name);
}

/** The argument text of the named decorator on this route, or undefined when
 * the route does not carry it. A bare `@Public()` returns an empty string. */
export function decoratorArgumentOf(route: Route, name: string): string | undefined {
  const decorator = routeDecorator(route, name);
  if (decorator === undefined) return undefined;
  return decoratorArgument(decorator) ?? '';
}

/** Members of a class, for guards that look past routes. */
export function membersOf(file: SourceFile): Array<{ parsed: ParsedClass; member: ClassMember }> {
  return parseClasses(file).flatMap((parsed) =>
    parsed.members.map((member) => ({ parsed, member })),
  );
}
