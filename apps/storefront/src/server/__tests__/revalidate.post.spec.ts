import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

import { __resetDedupForTests, handleRevalidate } from '../routes/api/_internal/revalidate.post';

interface FakeRecording {
  status: number;
  headers: Record<string, string>;
}

function createFakeEvent(opts: { headers?: Record<string, string>; body: unknown }): {
  event: H3Event;
  recorded: FakeRecording;
} {
  const recorded: FakeRecording = { status: 0, headers: {} };
  const inboundHeaders = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const event = {
    node: {
      req: {
        headers: inboundHeaders,
        method: 'POST',
      },
      res: {
        statusCode: 0,
        setHeader(name: string, value: string) {
          recorded.headers[name.toLowerCase()] = value;
        },
        getHeader(name: string) {
          return recorded.headers[name.toLowerCase()];
        },
      },
    },
    _requestBody: opts.body,
  } as unknown as H3Event;
  Object.defineProperty(recorded, 'status', {
    get() {
      return (event as unknown as { node: { res: { statusCode: number } } }).node.res.statusCode;
    },
  });
  return { event, recorded };
}

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3');
  return {
    ...actual,
    readBody: async (event: unknown) => (event as { _requestBody: unknown })._requestBody,
    getHeader: (event: unknown, name: string) =>
      (event as { node: { req: { headers: Record<string, string> } } }).node.req.headers[
        name.toLowerCase()
      ],
  };
});

const SECRET = 'a'.repeat(48);

const validBody = (
  overrides: Partial<{ paths: string[]; reason: string; eventId: string }> = {},
) => ({
  paths: ['/fr/catalog/product/airpods-pro', '/en/catalog/product/airpods-pro'],
  reason: 'product.write',
  eventId: '11111111-1111-4111-8111-111111111111',
  ...overrides,
});

describe('handleRevalidate', () => {
  beforeEach(() => {
    __resetDedupForTests();
  });
  afterEach(() => {
    __resetDedupForTests();
  });

  it('returns 401 when the secret env var is unset', async () => {
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': SECRET },
      body: validBody(),
    });
    const result = await handleRevalidate(event, { secret: undefined });
    expect(recorded.status).toBe(401);
    expect((result as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when no secret header is sent', async () => {
    const { event, recorded } = createFakeEvent({ body: validBody() });
    const result = await handleRevalidate(event, { secret: SECRET });
    expect(recorded.status).toBe(401);
    expect((result as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on a wrong secret (timing-safe compare, equal length)', async () => {
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': 'b'.repeat(48) },
      body: validBody(),
    });
    const result = await handleRevalidate(event, { secret: SECRET });
    expect(recorded.status).toBe(401);
    expect((result as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on a wrong secret of unequal length without comparing', async () => {
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': 'short' },
      body: validBody(),
    });
    const result = await handleRevalidate(event, { secret: SECRET });
    expect(recorded.status).toBe(401);
    expect((result as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when the body fails Zod validation', async () => {
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': SECRET },
      body: { paths: [], reason: 'product.write', eventId: 'not-a-uuid' },
    });
    const result = await handleRevalidate(event, { secret: SECRET });
    expect(recorded.status).toBe(400);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_BODY');
  });

  it('returns 400 when the reason is not allowlisted', async () => {
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': SECRET },
      body: validBody({ reason: 'order.placed' as never }),
    });
    await handleRevalidate(event, { secret: SECRET });
    expect(recorded.status).toBe(400);
  });

  it('returns 200 + invokes the invalidator for each path on the happy path', async () => {
    const invalidate = vi.fn(async () => undefined);
    const log = vi.fn();
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': SECRET },
      body: validBody(),
    });
    const result = await handleRevalidate(event, { secret: SECRET, invalidate, logger: log });
    expect(recorded.status).toBe(200);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith('/fr/catalog/product/airpods-pro');
    expect(invalidate).toHaveBeenCalledWith('/en/catalog/product/airpods-pro');
    expect((result as { data: { invalidated: number; deduped: boolean } }).data).toEqual({
      invalidated: 2,
      eventId: '11111111-1111-4111-8111-111111111111',
      deduped: false,
    });
  });

  it('returns 200 with deduped=true when eventId was already processed', async () => {
    const invalidate = vi.fn(async () => undefined);

    const { event: first } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': SECRET },
      body: validBody(),
    });
    await handleRevalidate(first, { secret: SECRET, invalidate });
    expect(invalidate).toHaveBeenCalledTimes(2);

    const { event: second, recorded: secondRec } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': SECRET },
      body: validBody(),
    });
    const result = await handleRevalidate(second, { secret: SECRET, invalidate });
    expect(secondRec.status).toBe(200);
    // No additional invalidate calls on dedup hit.
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect((result as { data: { invalidated: number; deduped: boolean } }).data).toEqual({
      invalidated: 0,
      eventId: '11111111-1111-4111-8111-111111111111',
      deduped: true,
    });
  });

  it('does not echo the secret in the response body on any path', async () => {
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': 'wrong-secret' },
      body: validBody(),
    });
    const result = await handleRevalidate(event, { secret: SECRET });
    expect(recorded.status).toBe(401);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('wrong-secret');
  });

  it('still returns 200 even if a per-path invalidator throws (best-effort)', async () => {
    const invalidate = vi.fn(async (path: string) => {
      if (path.includes('/en/')) throw new Error('cache miss');
    });
    const { event, recorded } = createFakeEvent({
      headers: { 'X-Revalidate-Secret': SECRET },
      body: validBody(),
    });
    const result = await handleRevalidate(event, { secret: SECRET, invalidate });
    expect(recorded.status).toBe(200);
    expect((result as { data: { invalidated: number } }).data.invalidated).toBe(2);
  });
});
