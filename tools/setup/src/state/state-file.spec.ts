import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRET_ANSWER_PATHS, getPath } from '../answers';
import { emptyState, markCompleted, mergeAnswers, readState, writeState } from './state-file';

describe('state file', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-state-'));
    file = path.join(dir, '.setup-state.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads an empty state when the file does not exist', () => {
    expect(readState(file)).toEqual(emptyState());
  });

  it('round-trips completed steps and non-secret answers', () => {
    let state = markCompleted(emptyState(), 'profile');
    state = mergeAnswers(state, { profile: 'engine', identity: { brandName: 'atlas' } });
    writeState(file, state, new Date('2026-09-06T00:00:00Z'));
    expect(readState(file)).toEqual({
      version: 1,
      completedSteps: ['profile'],
      answers: { profile: 'engine', identity: { brandName: 'atlas' } },
      updatedAt: '2026-09-06T00:00:00.000Z',
    });
  });

  it('never writes a secret', () => {
    // Plant every secret path and prove none of them reaches the disk. The
    // canary is the assertion that the planted value is in memory first: a
    // list nothing plants would pass on an empty state.
    let state = emptyState();
    for (const secret of SECRET_ANSWER_PATHS) {
      const keys = secret.split('.');
      const leaf: Record<string, unknown> = {};
      let node = leaf;
      for (const key of keys.slice(0, -1)) node = node[key] = {} as Record<string, unknown>;
      node[keys[keys.length - 1]] = `planted-${secret}`;
      state = mergeAnswers(state, leaf as never);
      expect(getPath(state.answers, secret)).toBe(`planted-${secret}`);
    }
    writeState(file, state);
    const written = fs.readFileSync(file, 'utf8');
    expect(written).not.toContain('planted-');
    for (const secret of SECRET_ANSWER_PATHS) {
      expect(getPath(readState(file).answers, secret)).toBeUndefined();
    }
  });

  it('keeps a non-secret sibling of a stripped secret', () => {
    const state = mergeAnswers(emptyState(), {
      mail: { apiKey: 're_secret', fromEmail: 'hello@shop.example' },
    });
    writeState(file, state);
    expect(readState(file).answers.mail).toEqual({ fromEmail: 'hello@shop.example' });
  });

  it('refuses a file from another version and names the fix', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 99, completedSteps: [], answers: {} }));
    expect(() => readState(file)).toThrow(/--reset/);
  });

  it('marks a step once', () => {
    const state = markCompleted(markCompleted(emptyState(), 'a'), 'a');
    expect(state.completedSteps).toEqual(['a']);
  });

  it('merges nested answers without dropping siblings and replaces arrays whole', () => {
    let state = mergeAnswers(emptyState(), {
      identity: { brandName: 'a', locality: 'x' },
      localization: { supportedLocales: ['fr', 'en'] },
    });
    state = mergeAnswers(state, {
      identity: { brandName: 'b' },
      localization: { supportedLocales: ['ar'] },
    });
    expect(state.answers).toEqual({
      identity: { brandName: 'b', locality: 'x' },
      localization: { supportedLocales: ['ar'] },
    });
  });
});
