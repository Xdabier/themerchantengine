import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import { getPath, isSecretPath } from '../answers';
import type { Output } from './ui';

/**
 * The prompt layer (plan E4.2). Every question names the answers path it
 * fills, so one implementation reads it from a document (`--answers`, CI) and
 * another asks a person; the steps never know which.
 */
export interface Question<T> {
  /** Dotted path in the answers object, `identity.brandName`. */
  path: string;
  label: string;
  /** Shown as the default and returned on an empty reply. */
  initial?: T;
  /** A message on a bad reply, or null when the reply is acceptable. */
  validate?: (value: T) => string | null;
  hint?: string;
}

export interface SelectQuestion<T extends string> extends Question<T> {
  choices: readonly { value: T; label: string }[];
}

export interface MultiSelectQuestion<T extends string> extends Question<T[]> {
  choices: readonly { value: T; label: string }[];
}

export interface Prompter {
  text(question: Question<string>): Promise<string>;
  secret(question: Question<string>): Promise<string>;
  confirm(question: Question<boolean>): Promise<boolean>;
  number(question: Question<number>): Promise<number>;
  select<T extends string>(question: SelectQuestion<T>): Promise<T>;
  multiSelect<T extends string>(question: MultiSelectQuestion<T>): Promise<T[]>;
}

export class MissingAnswerError extends Error {
  constructor(
    readonly path: string,
    label: string,
  ) {
    super(`no answer for ${path} (${label}); add it to the answers document`);
  }
}

export class InvalidAnswerError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
  }
}

function check<T>(question: Question<T>, value: T): T {
  const message = question.validate?.(value) ?? null;
  if (message) throw new InvalidAnswerError(question.path, message);
  return value;
}

/**
 * Answers every question from a document and never asks. A question the
 * document does not answer falls back to the question's own default, and a
 * question with neither is an error that names the path, so a CI run fails
 * on the missing line rather than hanging on a prompt.
 */
export class DocumentPrompter implements Prompter {
  constructor(private readonly document: unknown) {}

  private lookup<T>(question: Question<T>, expect: (v: unknown) => v is T): T {
    const value = getPath(this.document, question.path);
    if (value === undefined) {
      if (question.initial !== undefined) return check(question, question.initial);
      throw new MissingAnswerError(question.path, question.label);
    }
    if (!expect(value)) {
      // A secret of the wrong type is still a secret; the message names the
      // kind, not the value.
      const shown = isSecretPath(question.path) ? `a ${typeof value}` : JSON.stringify(value);
      throw new InvalidAnswerError(question.path, `unexpected value ${shown}`);
    }
    return check(question, value);
  }

  async text(q: Question<string>): Promise<string> {
    // The answers schema allows null where a value is optional (a Gulf
    // store's postal code), and a step writes null back for an empty answer,
    // so a document's null is the empty string a prompt would have returned.
    const value = getPath(this.document, q.path);
    if (value === null) return check(q, '');
    return this.lookup(q, (v): v is string => typeof v === 'string');
  }
  async secret(q: Question<string>): Promise<string> {
    return this.text(q);
  }
  async confirm(q: Question<boolean>): Promise<boolean> {
    return this.lookup(q, (v): v is boolean => typeof v === 'boolean');
  }
  async number(q: Question<number>): Promise<number> {
    return this.lookup(q, (v): v is number => typeof v === 'number' && Number.isFinite(v));
  }
  async select<T extends string>(q: SelectQuestion<T>): Promise<T> {
    const allowed = q.choices.map((c) => c.value);
    const value = this.lookup(q, (v): v is T => typeof v === 'string');
    if (!allowed.includes(value)) {
      throw new InvalidAnswerError(q.path, `must be one of ${allowed.join(', ')}, got ${value}`);
    }
    return value;
  }
  async multiSelect<T extends string>(q: MultiSelectQuestion<T>): Promise<T[]> {
    const allowed = q.choices.map((c) => c.value);
    const values = this.lookup(
      q,
      (v): v is T[] => Array.isArray(v) && v.every((x) => typeof x === 'string'),
    );
    const unknown = values.filter((v) => !allowed.includes(v));
    if (unknown.length > 0) {
      throw new InvalidAnswerError(q.path, `unknown choices ${unknown.join(', ')}`);
    }
    return values;
  }
}

/** One line read from a terminal. Hidden input for secrets, as `create-admin.ts` does. */
export interface LineReader {
  ask(prompt: string, hidden: boolean): Promise<string>;
  close(): void;
}

export function readlineReader(input: NodeJS.ReadableStream = process.stdin): LineReader {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = readline.createInterface({ input, output, terminal: true });
  return {
    ask(prompt, hidden) {
      return new Promise((resolve) => {
        // The prompt goes through readline, never straight to stdout: on a
        // real terminal `question()` redraws the current line before it
        // writes its own prompt, which erased a label written beside it and
        // left the operator answering an invisible question. readline writes
        // the prompt synchronously inside `question()`, so muting for a
        // secret starts only once the prompt is on screen.
        muted = false;
        rl.question(prompt, (answer) => {
          muted = false;
          if (hidden) process.stdout.write('\n');
          resolve(answer);
        });
        muted = hidden;
      });
    },
    close: () => rl.close(),
  };
}

/**
 * Asks a person, one question at a time, and re-asks on a bad reply. A
 * document, when given, answers first: an interactive run with a partial
 * answers file asks only what the file leaves out. The stored answers of a
 * previous run arrive as the questions' defaults, which is what makes a
 * re-run on the same box a series of Enter presses.
 */
export class InteractivePrompter implements Prompter {
  private readonly fromDocument: DocumentPrompter | null;

  constructor(
    private readonly reader: LineReader,
    private readonly out: Output,
    private readonly document: unknown = null,
  ) {
    this.fromDocument = document === null ? null : new DocumentPrompter(document);
  }

  private async askUntilValid<T>(
    question: Question<T>,
    render: string,
    parse: (raw: string) => T | null,
    hidden = false,
  ): Promise<T> {
    if (question.hint) this.out.write(`  ${question.hint}\n`);
    for (;;) {
      const raw = (await this.reader.ask(render, hidden)).trim();
      let value: T | null;
      if (raw === '' && question.initial !== undefined) value = question.initial;
      else value = parse(raw);
      if (value === null) {
        this.out.write('  please answer again\n');
        continue;
      }
      const message = question.validate?.(value) ?? null;
      if (message) {
        this.out.write(`  ${message}\n`);
        continue;
      }
      return value;
    }
  }

  /** True when the answers document carries this path, so a person is not asked for it. */
  private documented<T>(question: Question<T>): DocumentPrompter | null {
    return this.fromDocument !== null && getPath(this.document, question.path) !== undefined
      ? this.fromDocument
      : null;
  }

  async text(q: Question<string>): Promise<string> {
    const doc = this.documented(q);
    if (doc) return doc.text(q);
    const suffix = q.initial !== undefined && q.initial !== '' ? ` [${q.initial}]` : '';
    return this.askUntilValid(q, `  ${q.label}${suffix}: `, (raw) => raw);
  }

  async secret(q: Question<string>): Promise<string> {
    const doc = this.documented(q);
    if (doc) return doc.secret(q);
    const suffix = q.initial ? ' [keep current]' : '';
    return this.askUntilValid(q, `  ${q.label}${suffix}: `, (raw) => raw, true);
  }

  async confirm(q: Question<boolean>): Promise<boolean> {
    const doc = this.documented(q);
    if (doc) return doc.confirm(q);
    const suffix = q.initial === undefined ? ' (y/n)' : q.initial ? ' (Y/n)' : ' (y/N)';
    return this.askUntilValid(q, `  ${q.label}${suffix}: `, (raw) => {
      const v = raw.toLowerCase();
      if (v === 'y' || v === 'yes') return true;
      if (v === 'n' || v === 'no') return false;
      return null;
    });
  }

  async number(q: Question<number>): Promise<number> {
    const doc = this.documented(q);
    if (doc) return doc.number(q);
    const suffix = q.initial !== undefined ? ` [${q.initial}]` : '';
    return this.askUntilValid(q, `  ${q.label}${suffix}: `, (raw) => {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    });
  }

  async select<T extends string>(q: SelectQuestion<T>): Promise<T> {
    const doc = this.documented(q);
    if (doc) return doc.select(q);
    this.out.write(`  ${q.label}\n`);
    q.choices.forEach((c, i) => this.out.write(`    ${i + 1}) ${c.label}\n`));
    const initialIndex = q.choices.findIndex((c) => c.value === q.initial);
    const suffix = initialIndex >= 0 ? ` [${initialIndex + 1}]` : '';
    return this.askUntilValid(q, `  choice${suffix}: `, (raw) => {
      const byNumber = q.choices[Number(raw) - 1];
      if (byNumber) return byNumber.value;
      const byValue = q.choices.find((c) => c.value === raw);
      return byValue ? byValue.value : null;
    });
  }

  async multiSelect<T extends string>(q: MultiSelectQuestion<T>): Promise<T[]> {
    const doc = this.documented(q);
    if (doc) return doc.multiSelect(q);
    this.out.write(`  ${q.label} (comma-separated numbers)\n`);
    q.choices.forEach((c, i) => this.out.write(`    ${i + 1}) ${c.label}\n`));
    const initial = q.initial
      ? q.initial.map((v) => q.choices.findIndex((c) => c.value === v) + 1).join(',')
      : '';
    const suffix = initial ? ` [${initial}]` : '';
    return this.askUntilValid(q, `  choices${suffix}: `, (raw) => {
      const picked: T[] = [];
      for (const part of raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)) {
        const choice = q.choices[Number(part) - 1] ?? q.choices.find((c) => c.value === part);
        if (!choice) return null;
        if (!picked.includes(choice.value)) picked.push(choice.value);
      }
      return picked;
    });
  }
}
