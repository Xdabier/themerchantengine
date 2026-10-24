import { describe, expect, it } from 'vitest';
// @ts-expect-error plain CommonJS script without a declaration file
import { isWarm } from '../../apps/admin-e2e/e2e-server-marker.cjs';

// Reusing an admin dev server is safe only when the server on that port is the
// one the e2e launcher started. Reusing a dev-proxy server points the suite at
// the dev API, and therefore the dev database, which is how e2e fixtures reached
// a developer's dev data once already. Every case below is a way that could
// happen again; each one must come back false.

const marker = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ adminPort: '53211', apiPort: '53001', pid: 4242, ...over });

const warm = (over: Record<string, unknown> = {}, isAlive = () => true) =>
  isWarm({ adminPort: '53211', apiPort: '53001', read: () => marker(over), isAlive });

describe('e2e server marker', () => {
  it('reuses the server the launcher started for these exact ports', () => {
    expect(warm()).toBe(true);
  });

  it('refuses when no marker exists, which is what a dev server leaves behind', () => {
    expect(
      isWarm({
        adminPort: '53211',
        apiPort: '53001',
        read: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBe(false);
  });

  it('refuses an unreadable marker', () => {
    expect(isWarm({ adminPort: '53211', apiPort: '53001', read: () => 'not json' })).toBe(false);
  });

  it('refuses when the admin port does not match this run', () => {
    expect(warm({ adminPort: '53200' })).toBe(false);
  });

  it('refuses when the API port does not match, so a dev-API proxy is never reused', () => {
    expect(warm({ apiPort: '53000' })).toBe(false);
  });

  it('refuses when the launcher that wrote the marker is gone', () => {
    expect(warm({}, () => false)).toBe(false);
  });

  it('refuses a marker with no usable pid', () => {
    expect(warm({ pid: undefined })).toBe(false);
    expect(warm({ pid: '4242' })).toBe(false);
  });

  it('compares ports as text, so a numeric marker still matches', () => {
    expect(
      isWarm({ adminPort: 53211, apiPort: 53001, read: () => marker(), isAlive: () => true }),
    ).toBe(true);
  });
});
