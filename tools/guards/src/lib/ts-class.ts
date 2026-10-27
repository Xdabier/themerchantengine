import { SourceFile } from './repo';

/**
 * A line-shaped reader for decorated class members.
 *
 * Not a TypeScript parser: the repository is Prettier-formatted, so a class
 * member sits at exactly one indent level and every decorator that belongs to
 * it sits directly above it. That is enough structure to answer "which
 * decorators does this route handler carry", and it keeps the guards free of a
 * compiler dependency that would put a ts.Program build inside the test run.
 */

export interface ClassMember {
  readonly name: string;
  /** Decorator source text, one entry per decorator, in source order. */
  readonly decorators: readonly string[];
  /** 1-indexed line of the member's own declaration. */
  readonly line: number;
  /** The declaration line plus its parameter list, which is where the
   * parameter decorators (`@Body()`, `@IdempotencyKey()`, `@Query()`) live. */
  readonly signature: string;
}

export interface ParsedClass {
  readonly name: string;
  readonly decorators: readonly string[];
  readonly members: readonly ClassMember[];
  readonly line: number;
}

const CLASS_START = /^export\s+(?:abstract\s+)?class\s+(\w+)/;
const DECORATOR_START = /^(\s*)@(\w+)/;
const MEMBER_START =
  /^\s{2}(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:override\s+)?(?:readonly\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*[?!]?\s*[(<:=]/;

/** Net paren depth of a line, ignoring string contents. Used for the member
 * signature, where the body's opening brace must not extend the scan. */
function parenBalance(text: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === inString) inString = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') inString = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
  }
  return depth;
}

function balance(text: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === inString) inString = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') inString = char;
    else if (char === '(' || char === '[' || char === '{') depth++;
    else if (char === ')' || char === ']' || char === '}') depth--;
  }
  return depth;
}

/** Every exported class in the file, with its decorators and its members'. */
export function parseClasses(file: SourceFile): ParsedClass[] {
  const lines = file.text.split('\n');
  const classes: ParsedClass[] = [];

  let pending: string[] = [];
  let current: { name: string; decorators: string[]; members: ClassMember[]; line: number } | null =
    null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A decorator may wrap across lines. Consume until its parens balance.
    const decorator = DECORATOR_START.exec(line);
    if (decorator) {
      let text = line.trim();
      let depth = balance(text);
      while (depth > 0 && i + 1 < lines.length) {
        i++;
        text += `\n${lines[i].trim()}`;
        depth += balance(lines[i]);
      }
      pending.push(text);
      continue;
    }

    const classMatch = CLASS_START.exec(line);
    if (classMatch) {
      if (current) classes.push(current);
      current = { name: classMatch[1], decorators: pending, members: [], line: i + 1 };
      pending = [];
      continue;
    }

    if (current) {
      const member = MEMBER_START.exec(line);
      if (member) {
        let signature = line;
        let depth = parenBalance(line);
        let cursor = i;
        while (depth > 0 && cursor + 1 < lines.length) {
          cursor++;
          signature += `\n${lines[cursor]}`;
          depth += parenBalance(lines[cursor]);
        }
        current.members.push({ name: member[1], decorators: pending, line: i + 1, signature });
        pending = [];
        continue;
      }
      if (line === '}') {
        classes.push(current);
        current = null;
      }
    }

    // Anything else (a body line, a blank line, a brace) ends a decorator run
    // that did not reach a member, which only happens on a standalone comment.
    if (
      line.trim() === '' ||
      line.trim().startsWith('//') ||
      line.trim().startsWith('*') ||
      line.trim().startsWith('/*')
    ) {
      continue;
    }
    if (!decorator && !classMatch) pending = [];
  }

  if (current) classes.push(current);
  return classes;
}

/** The decorator's name, e.g. `Permissions` for `@Permissions('x:y')`. */
export function decoratorName(decorator: string): string {
  return /^@(\w+)/.exec(decorator)?.[1] ?? '';
}

/** True when the member or its class carries a decorator of this name. */
export function hasDecorator(parsed: ParsedClass, member: ClassMember, name: string): boolean {
  const matches = (d: string) => decoratorName(d) === name;
  return member.decorators.some(matches) || parsed.decorators.some(matches);
}

/** The single argument of `@Name(<arg>)`, trimmed, or undefined when absent. */
export function decoratorArgument(decorator: string): string | undefined {
  const open = decorator.indexOf('(');
  if (open === -1) return undefined;
  const inner = decorator.slice(open + 1, decorator.lastIndexOf(')')).trim();
  return inner === '' ? undefined : inner;
}
