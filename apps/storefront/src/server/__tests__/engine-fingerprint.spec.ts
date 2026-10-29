import { afterEach, describe, expect, it } from 'vitest';
import type { H3Event } from 'h3';

import engineFingerprintHandler from '../middleware/engine-fingerprint';

function createFakeEvent(headersSent = false): { event: H3Event; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const event = {
    node: {
      res: {
        headersSent,
        setHeader(name: string, value: string) {
          headers[name.toLowerCase()] = value;
        },
        getHeader(name: string) {
          return headers[name.toLowerCase()];
        },
      },
    },
  } as unknown as H3Event;
  return { event, headers };
}

describe('engine-fingerprint middleware', () => {
  const ORIGINAL = {
    flag: process.env['TME_FINGERPRINT'],
    version: process.env['TME_FINGERPRINT_VERSION'],
  };

  afterEach(() => {
    for (const [key, value] of [
      ['TME_FINGERPRINT', ORIGINAL.flag],
      ['TME_FINGERPRINT_VERSION', ORIGINAL.version],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('sets X-Powered-By to the engine name by default', async () => {
    delete process.env['TME_FINGERPRINT'];
    delete process.env['TME_FINGERPRINT_VERSION'];
    const { event, headers } = createFakeEvent();
    await engineFingerprintHandler(event);
    expect(headers['x-powered-by']).toBe('themerchantengine');
  });

  it('adds the major version when asked', async () => {
    process.env['TME_FINGERPRINT_VERSION'] = 'major';
    const { event, headers } = createFakeEvent();
    await engineFingerprintHandler(event);
    expect(headers['x-powered-by']).toBe('themerchantengine 1');
  });

  it('sends no header when TME_FINGERPRINT=off', async () => {
    process.env['TME_FINGERPRINT'] = 'off';
    const { event, headers } = createFakeEvent();
    await engineFingerprintHandler(event);
    expect(headers).not.toHaveProperty('x-powered-by');
  });

  it('skips a response that is already sent', async () => {
    const { event, headers } = createFakeEvent(true);
    await engineFingerprintHandler(event);
    expect(headers).toEqual({});
  });
});
