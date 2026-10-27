/**
 * Cloudflare Turnstile server-side verification (2026-06-25).
 *
 * The Better Auth `captcha` plugin verifies its own endpoints internally, but
 * there is no reusable siteverify at the NestJS layer — plain controllers
 * (newsletter, contact…) need their own call. This is it: a single POST to the
 * Cloudflare siteverify API, used by `BotProtectionGuard`.
 *
 * Fail-closed: any non-success response, malformed body, timeout, or network
 * error returns `false` (the request is rejected). The blast radius is limited
 * to bot-protected public forms (newsletter / contact), never core commerce, so
 * a brief Cloudflare outage degrading those signups is the acceptable trade for
 * not letting a bot flood through during one.
 */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5000;

export interface TurnstileVerifyDeps {
  /** Inject a custom fetch (tests). Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface SiteverifyResponse {
  success?: boolean;
  'error-codes'?: string[];
}

/** Verify a Turnstile token against Cloudflare. Returns true only on success. */
export async function verifyTurnstileToken(
  secret: string,
  token: string,
  remoteIp?: string,
  deps: TurnstileVerifyDeps = {},
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return false;

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);

  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as SiteverifyResponse;
    return data.success === true;
  } catch {
    return false;
  }
}
