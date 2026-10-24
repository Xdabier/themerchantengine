import type { ConfigService } from '@nestjs/config';
import { resolvePublicApiBase } from './public-api-url.util';

/**
 * Regression: outbound email links (newsletter confirm, RFC-8058 unsubscribe)
 * must include the API global prefix. Building `${base}/v1/...` without it 404s
 * on every deployment that sets one, prod runs `API_GLOBAL_PREFIX=api`, so the
 * real route is `/api/v1/...`. Dropping that join once shipped dead confirm
 * links to production (found in prod verification 2026-06-23), so every case
 * below still proves the join.
 */
function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string, def?: string) => values[key] ?? def,
  } as unknown as ConfigService;
}

describe('resolvePublicApiBase', () => {
  const ORIGINAL = process.env.API_GLOBAL_PREFIX;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.API_GLOBAL_PREFIX;
    else process.env.API_GLOBAL_PREFIX = ORIGINAL;
  });

  it('appends the configured global prefix (prod: api)', () => {
    delete process.env.API_GLOBAL_PREFIX;
    const cfg = fakeConfig({
      API_PUBLIC_BASE_URL: 'https://api.example.test',
      API_GLOBAL_PREFIX: 'api',
    });
    expect(resolvePublicApiBase(cfg)).toBe('https://api.example.test/api');
  });

  it('falls back to process.env for the prefix', () => {
    process.env.API_GLOBAL_PREFIX = 'api';
    const cfg = fakeConfig({ API_PUBLIC_BASE_URL: 'https://api.example.test' });
    expect(resolvePublicApiBase(cfg)).toBe('https://api.example.test/api');
  });

  it('returns the bare base when no prefix is set', () => {
    delete process.env.API_GLOBAL_PREFIX;
    const cfg = fakeConfig({ API_PUBLIC_BASE_URL: 'https://api.example.test' });
    expect(resolvePublicApiBase(cfg)).toBe('https://api.example.test');
  });

  it('normalises trailing/leading slashes', () => {
    delete process.env.API_GLOBAL_PREFIX;
    const cfg = fakeConfig({
      API_PUBLIC_BASE_URL: 'https://api.example.test/',
      API_GLOBAL_PREFIX: '/api/',
    });
    expect(resolvePublicApiBase(cfg)).toBe('https://api.example.test/api');
  });

  it('defaults to the client API host when API_PUBLIC_BASE_URL is unset', () => {
    process.env.API_GLOBAL_PREFIX = 'api';
    expect(resolvePublicApiBase(fakeConfig({}))).toBe('https://api.example.test/api');
  });
});
