import { defineEventHandler, setResponseHeader } from 'h3';
// Relative on purpose: Nitro bundles the server without the workspace
// tsconfig aliases.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  ENGINE_FINGERPRINT_HEADER,
  engineFingerprintValue,
} from '../../../../../libs/shared/common/src/fingerprint/engine-fingerprint';

/**
 * `X-Powered-By: themerchantengine` on every storefront response, so header
 * only detectors name the engine (DR-36). `TME_FINGERPRINT=off` drops it.
 */
export default defineEventHandler((event) => {
  if (event.node.res.headersSent) return;
  const value = engineFingerprintValue(process.env);
  if (value !== null) setResponseHeader(event, ENGINE_FINGERPRINT_HEADER, value);
});
