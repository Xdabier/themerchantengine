import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import {
  ENGINE_FINGERPRINT_HEADER,
  engineFingerprintValue,
  type FingerprintEnv,
} from '@common/fingerprint';

/**
 * Replace Express's `X-Powered-By: Express` with the engine name, so header
 * only detectors name the engine and never the framework (DR-36).
 * `TME_FINGERPRINT=off` sends no `X-Powered-By` at all.
 */
export function applyEngineFingerprint(
  app: NestExpressApplication,
  env: FingerprintEnv = process.env,
): void {
  app.disable('x-powered-by');
  const value = engineFingerprintValue(env);
  if (value === null) return;
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(ENGINE_FINGERPRINT_HEADER, value);
    next();
  });
}
