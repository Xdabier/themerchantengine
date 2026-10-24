import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG } from '@storefront-types';

import { fixtureRuntimeConfig } from '../../test-support/store-config-fixtures';
import { FAILURE_TTL_MS, readStoreConfig, resetStoreConfigCache } from '../store-config';

/**
 * The Nitro-side config read sits in the request path of every page, so what
 * it does when the API is unhappy matters more than what it does when the API
 * is fine. Every failure shape below has to end at the neutral config.
 */

const config = fixtureRuntimeConfig('gulf-rtl');

function okResponse(): Response {
  return { ok: true, json: async () => ({ data: config }) } as unknown as Response;
}

describe('readStoreConfig', () => {
  beforeEach(() => resetStoreConfigCache());

  it('reads the config and parses it against the wire schema', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(config);
  });

  it('caches across calls so a warm process makes one upstream request', async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await readStoreConfig(fetchImpl as unknown as typeof fetch);
    await readStoreConfig(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight request across a cold-start burst', async () => {
    // Without this a process handling its first burst opens one upstream call
    // per request, all asking the same question.
    const fetchImpl = vi.fn(async () => okResponse());
    await Promise.all(
      Array.from({ length: 5 }, () => readStoreConfig(fetchImpl as unknown as typeof fetch)),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the neutral config when the API refuses', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }) as unknown as Response);
    await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(
      NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
    );
  });

  it('falls back when the API is unreachable rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(
      NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
    );
  });

  it('falls back when the payload does not match the wire schema', async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: true, json: async () => ({ data: { money: 7 } }) }) as unknown as Response,
    );
    await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(
      NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
    );
  });

  it('remembers a failure only briefly, then picks a recovered API back up', async () => {
    // Both halves matter. Not remembering it at all made every request in this
    // path pay a fresh two-second timeout for as long as the API was down;
    // remembering it for the success TTL would turn a two-second outage into a
    // one-minute one (plan E2.6, B7.4).
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new Error('starting'))
        .mockResolvedValue(okResponse());

      await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(
        NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // Inside the window: answered from the remembered failure, no second call.
      await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(
        NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // Past it: retried, and the recovered API is served.
      vi.setSystemTime(Date.now() + FAILURE_TTL_MS + 1);
      await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(config);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the remembered failure once a read succeeds', async () => {
    // Otherwise a store that recovered would keep a stale failure timestamp and
    // skip its next read the moment the clock caught up with it.
    vi.useFakeTimers();
    try {
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new Error('starting'))
        .mockResolvedValue(okResponse());
      await readStoreConfig(fetchImpl as unknown as typeof fetch);
      vi.setSystemTime(Date.now() + FAILURE_TTL_MS + 1);
      await readStoreConfig(fetchImpl as unknown as typeof fetch);

      resetStoreConfigCache();
      fetchImpl.mockRejectedValueOnce(new Error('down again'));
      await expect(readStoreConfig(fetchImpl as unknown as typeof fetch)).resolves.toEqual(
        NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
