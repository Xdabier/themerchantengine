/**
 * CSP hashes for the inline scripts the framework emits and a nonce cannot
 * reach.
 *
 * Hydration event replay puts two executable inline scripts in the SSR
 * document. The `window.__jsaction_bootstrap(...)` call is emitted by the
 * Angular server renderer, which honours `CSP_NONCE`, so the per-request nonce
 * covers it. The event-dispatch contract is different: the builder inlines
 * `@angular/core/event-dispatch-contract.min.js` into `index.html` at build
 * time, and nothing per-request can stamp an attribute onto it. A hash is the
 * only directive that can admit it.
 *
 * The value below is the sha256 of that file, verified byte-for-byte against
 * what the renderer actually emits. It is a constant rather than something
 * computed at boot because the production server ships as a bundle and must not
 * depend on reading `node_modules` at runtime. `csp-script-hashes.spec.ts`
 * recomputes it from the installed package and fails if they diverge, so an
 * Angular upgrade that changes the script surfaces as a red test rather than as
 * a storefront where nothing is interactive until someone reads a console.
 */

/** sha256 of `@angular/core/event-dispatch-contract.min.js`, base64. */
export const EVENT_DISPATCH_CONTRACT_SHA256 = 'sha256-VM2mZqyEQZoLzoTrp5EigFvzQ0+f1wSeBuoOn95WHCg=';

/** Relative to the workspace root; the spec resolves and hashes this. */
export const EVENT_DISPATCH_CONTRACT_FILE =
  'node_modules/@angular/core/event-dispatch-contract.min.js';
