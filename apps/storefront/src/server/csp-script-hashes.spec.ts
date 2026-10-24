import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EVENT_DISPATCH_CONTRACT_FILE, EVENT_DISPATCH_CONTRACT_SHA256 } from './csp-script-hashes';

/**
 * The hash in the CSP has to match the script the browser is asked to run.
 *
 * The constant is checked in rather than computed at boot, because the
 * production server ships as a bundle and must not read `node_modules` at
 * runtime. That trade means the constant can silently go stale on an Angular
 * upgrade, and the symptom would be subtle: the contract script refused, event
 * replay inert, every interaction before hydration dropped, and nothing red
 * anywhere. This test is what makes that loud.
 */

const WORKSPACE_ROOT = resolve(__dirname, '..', '..', '..', '..');

describe('CSP script hashes', () => {
  it('matches the event-dispatch contract Angular actually ships', () => {
    const file = resolve(WORKSPACE_ROOT, EVENT_DISPATCH_CONTRACT_FILE);
    const source = readFileSync(file);

    // Non-empty, so a missing or truncated file cannot make this pass by
    // hashing nothing.
    expect(source.length).toBeGreaterThan(100);

    const actual = `sha256-${createHash('sha256').update(source).digest('base64')}`;
    expect(
      actual,
      'the Angular event-dispatch contract script changed, so the CSP hash in ' +
        'csp-script-hashes.ts no longer admits it. Event replay will be refused ' +
        'and every pre-hydration interaction dropped. Update the constant to the ' +
        'value on the left.',
    ).toBe(EVENT_DISPATCH_CONTRACT_SHA256);
  });

  it('is a well-formed sha256 CSP source expression', () => {
    expect(EVENT_DISPATCH_CONTRACT_SHA256).toMatch(/^sha256-[A-Za-z0-9+/]{43}=$/);
  });
});
