import { verifyTurnstileToken } from './turnstile.util';

function fetchReturning(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

describe('verifyTurnstileToken', () => {
  it('returns true when Cloudflare reports success', async () => {
    const ok = await verifyTurnstileToken('secret', 'token', '1.2.3.4', {
      fetchImpl: fetchReturning(200, { success: true }),
    });
    expect(ok).toBe(true);
  });

  it('returns false when Cloudflare reports failure', async () => {
    const ok = await verifyTurnstileToken('secret', 'token', undefined, {
      fetchImpl: fetchReturning(200, { success: false, 'error-codes': ['invalid-input-response'] }),
    });
    expect(ok).toBe(false);
  });

  it('fails closed on a non-2xx response', async () => {
    const ok = await verifyTurnstileToken('secret', 'token', undefined, {
      fetchImpl: fetchReturning(500, {}),
    });
    expect(ok).toBe(false);
  });

  it('fails closed on a network error', async () => {
    const throwing = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const ok = await verifyTurnstileToken('secret', 'token', undefined, { fetchImpl: throwing });
    expect(ok).toBe(false);
  });

  it('forwards secret, response, and remoteip to siteverify', async () => {
    let captured: { url: string; body: string } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), body: String(init.body) };
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response;
    }) as unknown as typeof fetch;

    await verifyTurnstileToken('s3cret', 'tok3n', '9.9.9.9', { fetchImpl: spy });

    expect(captured!.url).toContain('/siteverify');
    const params = new URLSearchParams(captured!.body);
    expect(params.get('secret')).toBe('s3cret');
    expect(params.get('response')).toBe('tok3n');
    expect(params.get('remoteip')).toBe('9.9.9.9');
  });
});
