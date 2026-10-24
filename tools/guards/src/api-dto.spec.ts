import {
  expectNoViolations,
  readCanary,
  readRepoFile,
  readTree,
  SourceFile,
  Violation,
} from './lib/repo';
import { Route, readRoutes } from './lib/controllers';

/**
 * Constitution 3.5: request bodies are explicit class-validator allowlists,
 * admin and customer DTOs are never the same class, and the global pipe strips
 * unknown properties.
 *
 * Replaces the retired `zod-dto-parity-auditor`'s backend half. The admin-side
 * Zod half is covered by `libs/admin-types` unit specs, which assert the two
 * shapes against the same fixtures.
 */
const GUARD = 'api-dto';

const BOOTSTRAP = 'apps/api/src/main.ts';

/** `@Body() dto: CreateProductAdminDto` and its multi-line form. */
const BODY_PARAM = /@Body\(\s*([^)]*)\s*\)\s*(\w+)\s*(\?)?\s*:\s*([A-Za-z_][\w.]*)/g;

const VALIDATOR_DECORATOR =
  /@(?:Is[A-Z]\w*|Matches|Length|MinLength|MaxLength|Min|Max|ValidateNested|ValidateIf|Type|Allow|ArrayM(?:in|ax)Size|Contains|Equals)\(/;

/** Body types that are not a validated class. */
const UNVALIDATABLE = new Set([
  'any',
  'unknown',
  'object',
  'Object',
  'Record',
  'string',
  'number',
  'boolean',
]);

export function checkBootstrap(main: string): Violation[] {
  const violations: Violation[] = [];
  if (!/new ValidationPipe\(\{[^}]*whitelist:\s*true/s.test(main)) {
    violations.push({
      file: BOOTSTRAP,
      line: 1,
      message:
        'the global ValidationPipe is not configured with whitelist: true (constitution 3.5).',
    });
  }
  if (!/new ClassSerializerInterceptor\(/.test(main)) {
    violations.push({
      file: BOOTSTRAP,
      line: 1,
      message:
        'ClassSerializerInterceptor is not registered globally, so @Exclude() fields would ship (constitution 3.5).',
    });
  }
  return violations;
}

interface BodyUse {
  readonly route: Route;
  readonly selector: string;
  readonly type: string;
}

export function bodyUses(routes: readonly Route[]): BodyUse[] {
  const uses: BodyUse[] = [];
  for (const route of routes) {
    BODY_PARAM.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BODY_PARAM.exec(route.signature)) !== null) {
      uses.push({ route, selector: match[1].trim(), type: match[4] });
    }
  }
  return uses;
}

/** Map a DTO class name to the file that declares it. */
export function declaredClasses(files: readonly SourceFile[]): Map<string, SourceFile> {
  const declared = new Map<string, SourceFile>();
  for (const file of files) {
    for (const match of file.text.matchAll(/^export\s+(?:abstract\s+)?class\s+(\w+)/gm)) {
      declared.set(match[1], file);
    }
  }
  return declared;
}

/** Base classes named in `extends`, including the ones wrapped by the mapped-type
 * helpers. `class UpdateXDto extends PartialType(CreateXDto) {}` inherits every
 * validator on `CreateXDto`, so the guard has to follow the chain. */
function baseClassesOf(className: string, source: SourceFile): string[] {
  const declaration = new RegExp(
    String.raw`export\s+(?:abstract\s+)?class\s+${className}\s+extends\s+([^{]+)\{`,
  ).exec(source.text);
  if (!declaration) return [];
  return [...declaration[1].matchAll(/\b([A-Z]\w*)\b/g)]
    .map((m) => m[1])
    .filter((name) => !['PartialType', 'PickType', 'OmitType', 'IntersectionType'].includes(name));
}

/** The body of one class, brace-matched. Checking the whole file instead would
 * let one validated class in a file vouch for every other class beside it. */
export function classBody(className: string, text: string): string {
  const declaration = new RegExp(
    String.raw`export\s+(?:abstract\s+)?class\s+${className}\b[^{]*\{`,
  ).exec(text);
  if (!declaration) return '';
  let depth = 0;
  const start = declaration.index + declaration[0].length - 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/** True when the class, or anything it extends, carries a validator. */
export function isValidated(
  className: string,
  declared: Map<string, SourceFile>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(className)) return false;
  seen.add(className);
  const source = declared.get(className);
  if (!source) return false;
  if (VALIDATOR_DECORATOR.test(classBody(className, source.text))) return true;
  return baseClassesOf(className, source).some((base) => isValidated(base, declared, seen));
}

/** Plucking one body property skips the whitelist strip, so it needs the same
 * kind of named, reviewable exception the raw-SQL rule uses. */
function pluckApproved(route: Route, sources: ReadonlyMap<string, string>): boolean {
  const text = sources.get(route.file) ?? '';
  return new RegExp(String.raw`body-pluck-approved:[^\n]*\b${route.handler}\b`).test(text);
}

export function checkBodies(
  routes: readonly Route[],
  declared: Map<string, SourceFile>,
  sources: ReadonlyMap<string, string> = new Map(),
): Violation[] {
  const violations: Violation[] = [];
  for (const use of bodyUses(routes)) {
    const { route, selector, type } = use;
    if (selector !== '') {
      if (pluckApproved(route, sources)) continue;
      violations.push({
        file: route.file,
        line: route.line,
        message: `${route.verb} /${route.path}: @Body(${selector}) plucks one property, which skips the whitelist strip. Take the whole body as a DTO class, or add a "body-pluck-approved: <handler> - <reason>" comment (constitution 3.5).`,
      });
      continue;
    }
    if (UNVALIDATABLE.has(type)) {
      violations.push({
        file: route.file,
        line: route.line,
        message: `${route.verb} /${route.path}: @Body() typed as "${type}" rather than a DTO class (constitution 3.5).`,
      });
      continue;
    }
    const source = declared.get(type);
    if (!source) {
      violations.push({
        file: route.file,
        line: route.line,
        message: `${route.verb} /${route.path}: @Body() DTO class "${type}" is not declared under apps/api/src. A body type the guard cannot find is a body nothing validates.`,
      });
      continue;
    }
    if (!isValidated(type, declared)) {
      violations.push({
        file: source.path,
        line: 1,
        message: `DTO "${type}" carries no class-validator decorator, on itself or on anything it extends, so the whitelist strips every field (constitution 3.5).`,
      });
    }
  }
  return violations;
}

const ADMIN_PATH = /(^|\/)admin(\/|$)/;

/** A DTO class reached from both lanes is one mass-assignment bug away from
 * letting a customer set an admin-only field. */
export function checkLaneSeparation(
  routes: readonly Route[],
  declared: Map<string, SourceFile>,
): Violation[] {
  const lanes = new Map<string, { admin: Route[]; storefront: Route[] }>();
  for (const use of bodyUses(routes)) {
    const entry = lanes.get(use.type) ?? { admin: [], storefront: [] };
    if (ADMIN_PATH.test(use.route.path)) entry.admin.push(use.route);
    else entry.storefront.push(use.route);
    lanes.set(use.type, entry);
  }
  const violations: Violation[] = [];
  for (const [type, { admin, storefront }] of lanes) {
    if (admin.length === 0 || storefront.length === 0) continue;
    violations.push({
      file: declared.get(type)?.path ?? 'apps/api/src',
      line: 1,
      message: `DTO "${type}" is the body of both an admin route (${admin[0].verb} /${admin[0].path}) and a storefront route (${storefront[0].verb} /${storefront[0].path}). Admin and customer DTOs are never shared (constitution 3.5).`,
    });
  }
  return violations;
}

describe(GUARD, () => {
  const apiFiles = readTree({ dirs: ['apps/api/src'], extensions: ['.ts'] });
  const routes = readRoutes(apiFiles.filter((f) => f.path.endsWith('.controller.ts')));
  const declared = declaredClasses(apiFiles);
  const sources = new Map(apiFiles.map((file) => [file.path, file.text]));

  it('keeps the global pipe stripping unknown properties and the serializer registered', () => {
    expectNoViolations(checkBootstrap(readRepoFile(BOOTSTRAP)));
  });

  it('finds every @Body() typed as a validated DTO class', () => {
    expectNoViolations(checkBodies(routes, declared, sources));
  });

  it('finds no DTO class shared between the admin and storefront lanes', () => {
    expectNoViolations(checkLaneSeparation(routes, declared));
  });

  it('reads a non-trivial number of request bodies, so a regex regression cannot pass as a clean tree', () => {
    expect(bodyUses(routes).length).toBeGreaterThan(50);
  });

  it('canary: the guard turns red on a loose body, an undecorated DTO and a shared DTO', () => {
    const canary = readCanary(GUARD);
    const canaryRoutes = readRoutes(canary.filter((f) => f.path.endsWith('.controller.ts')));
    const canaryDeclared = declaredClasses(canary);
    const messages = [
      ...checkBodies(canaryRoutes, canaryDeclared, new Map(canary.map((f) => [f.path, f.text]))),
      ...checkLaneSeparation(canaryRoutes, canaryDeclared),
    ].map((v) => v.message);
    expect(messages.some((m) => m.includes('rather than a DTO class'))).toBe(true);
    expect(messages.some((m) => m.includes('carries no class-validator decorator'))).toBe(true);
    expect(messages.some((m) => m.includes('plucks one property'))).toBe(true);
    expect(messages.some((m) => m.includes('is the body of both an admin route'))).toBe(true);
  });

  it('canary: the guard turns red when the bootstrap loses whitelist or the serializer', () => {
    const messages = checkBootstrap(
      'async function bootstrap() { app.useGlobalPipes(new ValidationPipe({})); }',
    ).map((v) => v.message);
    expect(messages.some((m) => m.includes('whitelist: true'))).toBe(true);
    expect(messages.some((m) => m.includes('ClassSerializerInterceptor'))).toBe(true);
  });
});
