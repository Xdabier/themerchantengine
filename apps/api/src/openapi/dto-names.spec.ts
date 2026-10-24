/**
 * Swagger registers a component schema by the class name of the DTO, so two
 * `*.dto.ts` classes that share a name merge into one schema and the generated
 * reference documents whichever body was registered last. Two identical copies
 * are harmless: the merge loses nothing, and per-module Translatable copies are
 * the norm here. Two copies with different bodies are a documentation bug, so
 * this spec walks every DTO file and refuses a same-named pair whose shape
 * differs, naming both files.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';

const API_SRC = path.resolve(__dirname, '..');
const REPO = path.resolve(__dirname, '..', '..', '..', '..');

interface DtoClass {
  name: string;
  file: string;
  /** The body, reduced to what Swagger reads: heritage, properties, their types and decorators. */
  shape: string;
}

/** Every `*.dto.ts` below `root`, sorted so the report order is stable. */
export function dtoFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.dto.ts')) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files.sort();
}

const squash = (text: string): string => text.replace(/\s+/g, '');

/** Heritage plus every property as `name?:type@Decorator(...)`, whitespace and order insensitive. */
function shapeOf(node: ts.ClassDeclaration, source: ts.SourceFile): string {
  const heritage = (node.heritageClauses ?? [])
    .map((clause) => squash(clause.getText(source)))
    .sort();
  const properties = node.members
    .filter(ts.isPropertyDeclaration)
    .map((member) => {
      const decorators = (ts.getDecorators(member) ?? [])
        .map((decorator) => squash(decorator.getText(source)))
        .sort();
      const name = member.name.getText(source);
      const optional = member.questionToken ? '?' : '';
      const type = member.type ? squash(member.type.getText(source)) : '';
      return `${name}${optional}:${type}${decorators.join('')}`;
    })
    .sort();
  return [...heritage, ...properties].join(';');
}

/** Every exported class of every DTO file below `root`, with its shape. */
export function collectDtoClasses(root: string): DtoClass[] {
  const classes: DtoClass[] = [];
  for (const file of dtoFiles(root)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    ts.forEachChild(source, function visit(node) {
      if (ts.isClassDeclaration(node) && node.name) {
        const exported = ts
          .getModifiers(node)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        if (exported) classes.push({ name: node.name.text, file, shape: shapeOf(node, source) });
      }
      ts.forEachChild(node, visit);
    });
  }
  return classes;
}

/** Repository-relative, forward slashes, so the report reads the same on every OS. */
const rel = (file: string): string => path.relative(REPO, file).split(path.sep).join('/');

/** One line per class name that is declared with more than one shape, naming every file of every shape. */
export function divergentDuplicates(classes: DtoClass[]): string[] {
  const byName = new Map<string, DtoClass[]>();
  for (const cls of classes) byName.set(cls.name, [...(byName.get(cls.name) ?? []), cls]);
  const problems: string[] = [];
  for (const [name, copies] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const filesPerShape = new Map<string, string[]>();
    for (const copy of copies) {
      filesPerShape.set(copy.shape, [...(filesPerShape.get(copy.shape) ?? []), rel(copy.file)]);
    }
    if (filesPerShape.size > 1) {
      const groups = [...filesPerShape.values()].map((files) => files.join(', ')).join(' and ');
      problems.push(
        `${name} is declared with different bodies in ${groups}; Swagger merges same-named DTOs into one schema, so rename one of them.`,
      );
    }
  }
  return problems;
}

describe('DTO class names across apps/api/src', () => {
  // Identical duplicates are allowed on purpose: Swagger merges them into one
  // schema without loss, and the per-module Translatable copies rely on that.
  it('are unique, or every same-named pair has the same body', () => {
    expect(divergentDuplicates(collectDtoClasses(API_SRC)).join('\n')).toBe('');
  });
});

describe('the rule on a planted tree', () => {
  let root: string;
  const plant = (relative: string, body: string) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dto-names-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fails on two same-named classes with different bodies, naming both files', () => {
    plant('a/item.dto.ts', `export class ItemDto { @IsString() productId: string; }`);
    plant('b/item.dto.ts', `export class ItemDto { @IsNumber() weight: number; }`);
    const problems = divergentDuplicates(collectDtoClasses(root));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^ItemDto is declared with different bodies in .*a\/item\.dto\.ts and .*b\/item\.dto\.ts/,
    );
  });

  it('fails when only a decorator differs', () => {
    plant('a/t.dto.ts', `export class TDto { @IsString() @IsNotEmpty() default: string; }`);
    plant('b/t.dto.ts', `export class TDto { @IsString() default!: string; }`);
    expect(divergentDuplicates(collectDtoClasses(root))).toHaveLength(1);
  });

  it('passes two identical classes that differ only in whitespace, decorator order and the ! token', () => {
    plant(
      'a/t.dto.ts',
      `import { X } from 'x';\nexport class TDto extends Base {\n  @IsString()\n  @IsNotEmpty()\n  default: string;\n\n  @IsOptional() @IsInt() count?: number;\n}`,
    );
    plant(
      'b/t.dto.ts',
      `export class TDto extends Base { @IsOptional() @IsInt() count?: number; @IsNotEmpty() @IsString() default!: string }`,
    );
    expect(divergentDuplicates(collectDtoClasses(root))).toEqual([]);
  });

  it('ignores a file that is not a DTO file and a class that is not exported', () => {
    plant('a/item.dto.ts', `export class ItemDto { @IsString() productId: string; }`);
    plant('b/item.service.ts', `export class ItemDto { @IsNumber() weight: number; }`);
    plant('c/item.dto.ts', `class ItemDto { @IsNumber() weight: number; }`);
    expect(divergentDuplicates(collectDtoClasses(root))).toEqual([]);
  });
});
