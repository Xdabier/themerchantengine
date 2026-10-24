import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STOREFRONT_AUTH_CLIENT,
  createStorefrontAuthClient,
  storefrontAuthBaseUrl,
} from './auth-client';

describe('storefrontAuthBaseUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds the absolute /v1/auth URL from the browser origin', () => {
    vi.stubGlobal('location', { origin: 'https://shop.test' });
    expect(storefrontAuthBaseUrl()).toBe('https://shop.test/v1/auth');
  });

  it('falls back to an absolute placeholder with no browser location (SSR / test env)', () => {
    expect(storefrontAuthBaseUrl()).toBe('http://localhost/v1/auth');
  });
});

describe('createStorefrontAuthClient', () => {
  it('exposes the auth methods the storefront consumes', () => {
    const client = createStorefrontAuthClient('http://localhost/v1/auth');
    expect(typeof client.getSession).toBe('function');
    expect(typeof client.signIn.email).toBe('function');
    expect(typeof client.signIn.magicLink).toBe('function');
    expect(typeof client.signUp.email).toBe('function');
    expect(typeof client.signOut).toBe('function');
    expect(typeof client.requestPasswordReset).toBe('function');
    expect(typeof client.resetPassword).toBe('function');
  });
});

describe('STOREFRONT_AUTH_CLIENT', () => {
  it('is a named InjectionToken', () => {
    expect(STOREFRONT_AUTH_CLIENT.toString()).toContain('STOREFRONT_AUTH_CLIENT');
  });
});
