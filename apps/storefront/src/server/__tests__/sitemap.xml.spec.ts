import { describe, expect, it, vi } from 'vitest';

import sitemapXmlHandler from '../routes/sitemap.xml';

describe('GET /sitemap.xml route handler', () => {
  it('issues a 301 redirect to /sitemap_index.xml', async () => {
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
    } as unknown as Parameters<typeof sitemapXmlHandler>[0];

    // h3's sendRedirect writes Location + status to event.node.res. Stub end()
    // so the handler resolves without trying to actually write a body.
    Object.defineProperty(event.node.res, 'writeHead', {
      value: (code: number, headers: Record<string, string>) => {
        redirectCode = code;
        redirectLocation = headers['location'] ?? headers['Location'];
        for (const [k, v] of Object.entries(headers)) recorded[k.toLowerCase()] = v;
      },
    });

    // Some h3 versions call setResponseStatus then setResponseHeader — capture
    // both pathways. The test asserts the final-state outputs regardless.
    await sitemapXmlHandler(event);

    const status = redirectCode ?? event.node.res.statusCode;
    const location = redirectLocation ?? recorded['location'];
    expect(status).toBe(301);
    expect(location).toBe('/sitemap_index.xml');
    expect(recorded['cache-control']).toBe('public, max-age=86400');
  });
});
