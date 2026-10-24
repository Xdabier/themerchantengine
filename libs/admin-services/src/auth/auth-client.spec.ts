import { authBaseUrl } from './auth-client';

/**
 * `authBaseUrl` normalises the admin's API base into the absolute Better Auth
 * URL the client demands. Importing `./auth-client` is safe under Jest:
 * `better-auth/client` is stubbed via `moduleNameMapper`. These specs cover the
 * relative vs absolute branch and the trailing-slash trim — `createAdminAuthClient`
 * (which would construct the real client) is never called.
 */
describe('authBaseUrl', () => {
  it('resolves a relative base against the page origin', () => {
    // jsdom serves the test page from http://localhost.
    expect(authBaseUrl('/api')).toBe('http://localhost/api/v1/auth');
  });

  it('keeps an absolute base as-is', () => {
    expect(authBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1/auth');
  });

  it('trims a trailing slash from an absolute base', () => {
    expect(authBaseUrl('https://api.example.com/')).toBe('https://api.example.com/v1/auth');
  });
});
