import { randomBytes } from 'node:crypto';

/**
 * Per-request CSP nonce, shared between the header and the renderer.
 *
 * `script-src 'self'` blocks every inline `<script>`, and Angular emits two of
 * them as soon as hydration replays events: `ng-event-dispatch-contract` and
 * the `window.__jsaction_bootstrap(...)` call that arms it. Without a nonce
 * both are refused, in every browser, so event replay is silently inert and
 * every page load reports two CSP violations to the console. That is not a
 * theoretical posture question: it was verified against the rendered HTML,
 * which carries exactly two executable inline scripts with event replay on and
 * none with it off.
 *
 * A nonce is the sanctioned way to allow a script the server itself emitted
 * while still refusing anything injected. It does not weaken `'self'`: without
 * `'strict-dynamic'`, both continue to apply, so an attacker-injected inline
 * script with no nonce is still refused. It does mean each response is unique,
 * which is correct here because the SSR document is not shared-cacheable
 * anyway.
 *
 * The value is stashed on the Node request object because that is the one
 * thing the Nitro middleware and the Angular server injector both see: the
 * middleware writes it while building the header, and `app.config.server.ts`
 * reads it back through Analog's `injectRequest()` to provide `CSP_NONCE`.
 */

const NONCE_KEY = '__storefrontCspNonce';

interface NonceCarrier {
  [NONCE_KEY]?: string;
}

/** 128 bits, base64. The CSP spec asks for at least 128 bits of entropy. */
export function createCspNonce(): string {
  return randomBytes(16).toString('base64');
}

export function setCspNonce(carrier: unknown, nonce: string): void {
  if (carrier && typeof carrier === 'object') {
    (carrier as NonceCarrier)[NONCE_KEY] = nonce;
  }
}

/**
 * Null when absent rather than a fresh value: a nonce the header never
 * advertised would be worse than none, because the script would be refused
 * anyway and the mismatch would be invisible.
 */
export function readCspNonce(carrier: unknown): string | null {
  if (!carrier || typeof carrier !== 'object') return null;
  return (carrier as NonceCarrier)[NONCE_KEY] ?? null;
}
