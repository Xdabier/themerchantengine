import { describe, expect, it } from 'vitest';
import { GENERATED_SECRET_KEYS, SECRET_BYTES, generateSecret, generateSecrets } from './secrets';

describe('generateSecrets', () => {
  it('produces 32 random bytes as 64 hex characters per key', () => {
    const secrets = generateSecrets();
    for (const key of GENERATED_SECRET_KEYS) {
      expect(secrets[key]).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(new Set(Object.values(secrets)).size).toBe(GENERATED_SECRET_KEYS.length);
  });

  it('draws the bytes from the given source', () => {
    const calls: number[] = [];
    const secret = generateSecret((n) => {
      calls.push(n);
      return Buffer.alloc(n, 0xab);
    });
    expect(calls).toEqual([SECRET_BYTES]);
    expect(secret).toBe('ab'.repeat(SECRET_BYTES));
  });

  it('keeps an existing non-empty value and regenerates an empty one', () => {
    const secrets = generateSecrets({ DB_PASSWORD: 'keep-me', REDIS_PASSWORD: '' });
    expect(secrets.DB_PASSWORD).toBe('keep-me');
    expect(secrets.REDIS_PASSWORD).toMatch(/^[0-9a-f]{64}$/);
  });
});
