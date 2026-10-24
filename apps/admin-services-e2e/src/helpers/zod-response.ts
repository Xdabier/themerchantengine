import type { APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';
import type { z } from 'zod';

/**
 * Assert an HTTP response matches the given Zod schema. Returns the parsed
 * value on success so callers can drill into typed fields. On failure the
 * test output shows both the status + the Zod issue list so drift is easy
 * to diagnose.
 */
export async function expectSchema<T extends z.ZodTypeAny>(
  response: APIResponse,
  schema: T,
  opts: { status?: number } = {},
): Promise<z.infer<T>> {
  const status = response.status();
  if (opts.status !== undefined) {
    if (status !== opts.status) {
      const body = await safeJson(response);
      expect(
        status,
        `Expected ${opts.status} but got ${status}. Body: ${JSON.stringify(body)}`,
      ).toBe(opts.status);
    }
  } else {
    expect(status, `Unexpected status ${status}`).toBeGreaterThanOrEqual(200);
    expect(status, `Unexpected status ${status}`).toBeLessThan(300);
  }

  const body = await safeJson(response);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • [${i.path.join('.') || '<root>'}] ${i.message}`)
      .join('\n');
    throw new Error(
      `Response did not match schema.\nURL: ${response.url()}\nStatus: ${status}\nIssues:\n${issues}\nBody: ${JSON.stringify(
        body,
      ).slice(0, 500)}`,
    );
  }
  return parsed.data;
}

async function safeJson(response: APIResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}
