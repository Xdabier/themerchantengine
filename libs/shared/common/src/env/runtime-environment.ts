/**
 * The one reading of `NODE_ENV` the engine makes (plan E4, DR-31, §3.14).
 *
 * An allow-list, not a deny-list. `development` and `test` are the only labels
 * that unlock a development behaviour: a public-key override, a mail redirect,
 * a throttle kill-switch, a stack trace in a response, a fixture that rewrites
 * a store's config. Every other label reads as production, and so does no
 * label at all.
 *
 * The previous shape compared against the exact string `production` at each
 * site, so `prod`, `staging`, `Production` and an unset variable each got the
 * development behaviour. Nothing validates or defaults `NODE_ENV`, and the
 * party who sets it is whoever starts the container, so a deny-list there put
 * every one of those behaviours one variable away from a licensee. The E3 gate
 * B security review found six of them; this predicate is the single source
 * they all consume now.
 */
export const RUNTIME_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

/** Anything that can answer for `NODE_ENV`: `process.env`, a record, or a Nest `ConfigService`. */
export type EnvironmentSource =
  | { NODE_ENV?: string | undefined }
  | Record<string, string | undefined>
  | { get(key: string): unknown };

function nodeEnvOf(source: EnvironmentSource): string | undefined {
  if (typeof (source as { get?: unknown }).get === 'function') {
    const value = (source as { get(key: string): unknown }).get('NODE_ENV');
    return typeof value === 'string' ? value : undefined;
  }
  return (source as Record<string, string | undefined>)['NODE_ENV'];
}

/** `development` or `test` when `NODE_ENV` says exactly that; `production` otherwise. */
export function runtimeEnvironment(source: EnvironmentSource = process.env): RuntimeEnvironment {
  const label = nodeEnvOf(source);
  return label === 'development' || label === 'test' ? label : 'production';
}

export function isProduction(source: EnvironmentSource = process.env): boolean {
  return runtimeEnvironment(source) === 'production';
}

export function isDevelopment(source: EnvironmentSource = process.env): boolean {
  return runtimeEnvironment(source) === 'development';
}

export function isTest(source: EnvironmentSource = process.env): boolean {
  return runtimeEnvironment(source) === 'test';
}
