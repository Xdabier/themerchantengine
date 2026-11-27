import type { NestExpressApplication } from '@nestjs/platform-express';

export type TrustProxySetting = boolean | number | string;

/**
 * Reads `TRUST_PROXY` into the value Express's `trust proxy` setting takes:
 * `true` or `false`, a hop count, or a list of names and subnets such as
 * `loopback` or `10.0.0.0/8`.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Behind a reverse proxy every request comes from the proxy's address, so
 * the per-IP throttle puts all visitors in one bucket. Setting `TRUST_PROXY`
 * makes `req.ip` the client address from `X-Forwarded-For`. Unset keeps the
 * Express default, which ignores that header.
 */
export function applyTrustProxy(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const setting = parseTrustProxy(env.TRUST_PROXY);
  if (setting === undefined) return;
  app.set('trust proxy', setting);
}
