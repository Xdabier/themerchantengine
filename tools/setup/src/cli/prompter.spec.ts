import * as fs from 'node:fs';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Output } from './ui';
import {
  DocumentPrompter,
  InteractivePrompter,
  InvalidAnswerError,
  MissingAnswerError,
  readlineReader,
  type LineReader,
} from './prompter';

function fakeOutput(): Output & { text: string } {
  const out = {
    text: '',
    isTTY: false,
    write(chunk: string) {
      out.text += chunk;
    },
  };
  return out;
}

function scriptedReader(replies: string[]): LineReader & { prompts: string[]; hidden: boolean[] } {
  const reader = {
    prompts: [] as string[],
    hidden: [] as boolean[],
    async ask(prompt: string, hidden: boolean) {
      reader.prompts.push(prompt);
      reader.hidden.push(hidden);
      const next = replies.shift();
      if (next === undefined) throw new Error('the script ran out of replies');
      return next;
    },
    close() {
      /* nothing to release */
    },
  };
  return reader;
}

describe('DocumentPrompter', () => {
  const doc = {
    identity: { brandName: 'atlas', contactEmail: 'x', postalCode: null },
    money: { displayPrecision: 3 },
    demoCatalogue: true,
    localization: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr' },
  };
  const prompter = new DocumentPrompter(doc);

  it('answers every kind of question from the document', async () => {
    await expect(prompter.text({ path: 'identity.brandName', label: 'b' })).resolves.toBe('atlas');
    await expect(prompter.number({ path: 'money.displayPrecision', label: 'p' })).resolves.toBe(3);
    await expect(prompter.confirm({ path: 'demoCatalogue', label: 'd' })).resolves.toBe(true);
    await expect(
      prompter.select({
        path: 'localization.defaultLocale',
        label: 'l',
        choices: [
          { value: 'fr', label: 'fr' },
          { value: 'en', label: 'en' },
        ],
      }),
    ).resolves.toBe('fr');
    await expect(
      prompter.multiSelect({
        path: 'localization.supportedLocales',
        label: 'l',
        choices: [
          { value: 'fr', label: 'fr' },
          { value: 'en', label: 'en' },
          { value: 'ar', label: 'ar' },
        ],
      }),
    ).resolves.toEqual(['fr', 'en']);
  });

  it('reads a null text answer as the empty string, the way the answers schema allows it', async () => {
    // A Gulf store has no postal code: the fixture and the answers schema
    // both say null, and the identity step writes null back for an empty
    // answer, so a document must round-trip it.
    await expect(
      prompter.text({ path: 'identity.postalCode', label: 'Postal code (or empty)' }),
    ).resolves.toBe('');
    await expect(prompter.number({ path: 'identity.postalCode', label: 'n' })).rejects.toThrow(
      /unexpected value/,
    );
  });

  it('falls back to the question default and otherwise names the missing path', async () => {
    await expect(
      prompter.text({ path: 'identity.region', label: 'Region', initial: '' }),
    ).resolves.toBe('');
    await expect(prompter.text({ path: 'identity.region', label: 'Region' })).rejects.toThrow(
      MissingAnswerError,
    );
    await expect(prompter.text({ path: 'identity.region', label: 'Region' })).rejects.toThrow(
      /identity\.region/,
    );
  });

  it('runs the validator and refuses a value of the wrong kind or outside the choices', async () => {
    await expect(
      prompter.text({
        path: 'identity.contactEmail',
        label: 'e',
        validate: (v) => (v.includes('@') ? null : 'not an email'),
      }),
    ).rejects.toThrow(InvalidAnswerError);
    await expect(prompter.number({ path: 'identity.brandName', label: 'n' })).rejects.toThrow(
      /unexpected value/,
    );
    await expect(
      prompter.select({
        path: 'identity.brandName',
        label: 's',
        choices: [{ value: 'a', label: 'a' }],
      }),
    ).rejects.toThrow(/must be one of a/);
  });
});

describe('InteractivePrompter', () => {
  it('asks, shows the default, and takes Enter as the default', async () => {
    const reader = scriptedReader(['']);
    const p = new InteractivePrompter(reader, fakeOutput());
    await expect(p.text({ path: 'a', label: 'Name', initial: 'kept' })).resolves.toBe('kept');
    expect(reader.prompts[0]).toContain('[kept]');
  });

  it('re-asks on a validation failure and hides a secret', async () => {
    const reader = scriptedReader(['nope', 'ok@x']);
    const out = fakeOutput();
    const p = new InteractivePrompter(reader, out);
    await expect(
      p.secret({
        path: 'mail.apiKey',
        label: 'Key',
        validate: (v) => (v.includes('@') ? null : 'needs an @'),
      }),
    ).resolves.toBe('ok@x');
    expect(reader.hidden).toEqual([true, true]);
    expect(out.text).toContain('needs an @');
  });

  it('accepts a choice by number or by value and refuses the rest', async () => {
    const reader = scriptedReader(['9', 'en', '1']);
    const p = new InteractivePrompter(reader, fakeOutput());
    const choices = [
      { value: 'fr', label: 'French' },
      { value: 'en', label: 'English' },
    ] as const;
    await expect(p.select({ path: 'l', label: 'Locale', choices })).resolves.toBe('en');
    await expect(p.select({ path: 'l', label: 'Locale', choices })).resolves.toBe('fr');
  });

  it('parses y/n and a comma-separated multi choice', async () => {
    const reader = scriptedReader(['maybe', 'y', '1, 3']);
    const p = new InteractivePrompter(reader, fakeOutput());
    await expect(p.confirm({ path: 'c', label: 'Sure' })).resolves.toBe(true);
    await expect(
      p.multiSelect({
        path: 'm',
        label: 'Locales',
        choices: [
          { value: 'fr', label: 'fr' },
          { value: 'en', label: 'en' },
          { value: 'ar', label: 'ar' },
        ],
      }),
    ).resolves.toEqual(['fr', 'ar']);
  });

  it('takes an answer from the document first and asks only what it leaves out', async () => {
    const reader = scriptedReader(['typed']);
    const p = new InteractivePrompter(reader, fakeOutput(), { identity: { brandName: 'fromdoc' } });
    await expect(p.text({ path: 'identity.brandName', label: 'Brand' })).resolves.toBe('fromdoc');
    await expect(p.text({ path: 'identity.region', label: 'Region' })).resolves.toBe('typed');
    expect(reader.prompts).toHaveLength(1);
  });
});

describe('readlineReader', () => {
  function capture(): { text: () => string; restore: () => void } {
    const original = process.stdout.write.bind(process.stdout);
    let buffer = '';
    process.stdout.write = ((chunk: string | Uint8Array) => {
      buffer += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    return { text: () => buffer, restore: () => (process.stdout.write = original) };
  }

  it('shows the prompt and echoes a visible answer, and hides a secret while still showing its prompt', async () => {
    const input = new PassThrough();
    const reader = readlineReader(input);
    const seen = capture();
    try {
      const visible = reader.ask('  Store name: ', false);
      input.write('Atlas\n');
      expect(await visible).toBe('Atlas');
      expect(seen.text()).toContain('  Store name: ');
      const hidden = reader.ask('  Password: ', true);
      input.write('Secret1234\n');
      expect(await hidden).toBe('Secret1234');
      expect(seen.text()).toContain('  Password: ');
      expect(seen.text()).not.toContain('Secret1234');
    } finally {
      seen.restore();
      reader.close();
    }
  });

  it('hands the prompt to readline rather than writing it beside readline, which erased it on a terminal', () => {
    const source = fs.readFileSync(path.join(__dirname, 'prompter.ts'), 'utf8');
    const reader = source.slice(
      source.indexOf('export function readlineReader'),
      source.indexOf('export class InteractivePrompter'),
    );
    expect(reader).toMatch(/rl\.question\(prompt,/);
    expect(reader).not.toMatch(/process\.stdout\.write\(prompt\)/);
  });
});
