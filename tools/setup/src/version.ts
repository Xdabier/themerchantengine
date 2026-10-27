/** Injected by build.mjs from the root package.json; the fallback is what `vitest` and `tsc` see. */
declare const __ENGINE_VERSION__: string | undefined;

export const ENGINE_VERSION: string =
  typeof __ENGINE_VERSION__ === 'string' ? __ENGINE_VERSION__ : 'source';
