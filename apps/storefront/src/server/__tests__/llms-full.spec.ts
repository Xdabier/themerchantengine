import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG } from '@storefront-types';

import llmsFullHandler from '../routes/llms-full.txt';
import llmsFullAliasHandler from '../routes/llms_full.txt';

// The proxy reads the store default locale; keep that read off the stubbed global fetch.
vi.mock('../store-config', () => ({
  readStoreConfig: async () => NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
}));

describe('GET /llms-full.txt route handler', () => {
  it('proxies upstream /v1/llms-full.txt with Accept-Language forwarded', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('# Demo Store\n\n## Products\n\n### Widget', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    ) as unknown as typeof fetch;

    const recorded: Record<string, string> = {};
    let statusCode = 0;
    const event = {
      node: {
        req: { headers: { 'accept-language': 'en' } },
        res: {
          get statusCode() {
            return statusCode;
          },
          set statusCode(v: number) {
            statusCode = v;
          },
          setHeader(name: string, value: string) {
            recorded[name.toLowerCase()] = value;
          },
          getHeader(name: string) {
            return recorded[name.toLowerCase()];
          },
        },
      },
    } as unknown as Parameters<typeof llmsFullHandler>[0];

    // The handler reads STOREFRONT_API_URL from process.env via a closure;
    // monkey-patch globalThis.fetch since the route default-imports the
    // helper. Bypassing the helper's fetchImpl knob requires a stub here.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const body = await llmsFullHandler(event);
      expect(body).toContain('# Demo Store');
      expect(body).toContain('## Products');
      expect(statusCode).toBe(200);
      expect(recorded['content-type']).toBe('text/plain; charset=utf-8');
      expect(recorded['vary']).toBe('Accept-Language');
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Upstream URL ends with /v1/llms-full.txt and Accept-Language was
    // forwarded (forwardAcceptLanguage: true).
    const callArgs = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(callArgs[0]).toMatch(/\/v1\/llms-full\.txt$/);
    const init = callArgs[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('en');
  });
});

describe('GET /llms_full.txt alias handler', () => {
  it('301-redirects to the canonical /llms-full.txt', async () => {
    let redirectLocation: string | undefined;
    let redirectCode: number | undefined;
    const recorded: Record<string, string> = {};
    const event = {
      node: {
        res: {
          statusCode: 0,
          end: vi.fn(),
          setHeader(name: string, value: string) {
            recorded[name.toLowerCase()] = value;
          },
          getHeader(name: string) {
            return recorded[name.toLowerCase()];
          },
        },
      },
    } as unknown as Parameters<typeof llmsFullAliasHandler>[0];

    Object.defineProperty(event.node.res, 'writeHead', {
      value: (code: number, headers: Record<string, string>) => {
        redirectCode = code;
        redirectLocation = headers['location'] ?? headers['Location'];
        for (const [k, v] of Object.entries(headers)) recorded[k.toLowerCase()] = v;
      },
    });

    await llmsFullAliasHandler(event);

    const status = redirectCode ?? event.node.res.statusCode;
    const location = redirectLocation ?? recorded['location'];
    expect(status).toBe(301);
    expect(location).toBe('/llms-full.txt');
    expect(recorded['cache-control']).toBe('public, max-age=86400');
  });
});
