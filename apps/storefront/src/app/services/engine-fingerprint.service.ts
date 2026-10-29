import { DOCUMENT, isPlatformServer } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';

import {
  ENGINE_FINGERPRINT_APP_ATTRIBUTE,
  ENGINE_FINGERPRINT_META_NAME,
  engineFingerprintValue,
  type FingerprintEnv,
} from '@common/fingerprint';

/**
 * Applies the operator's fingerprint flags to the static markers in
 * `index.html` (DR-36). Server pass only: the flags are server env, and the
 * browser hydrates the document the server already shaped.
 */
@Injectable({ providedIn: 'root' })
export class EngineFingerprintService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  apply(env: FingerprintEnv = serverEnv()): void {
    if (!isPlatformServer(this.platformId)) return;
    const meta = this.document.querySelector(`meta[name="${ENGINE_FINGERPRINT_META_NAME}"]`);
    const value = engineFingerprintValue(env);
    if (value === null) {
      meta?.remove();
      this.document.documentElement.removeAttribute(ENGINE_FINGERPRINT_APP_ATTRIBUTE);
      return;
    }
    meta?.setAttribute('content', value);
  }
}

function serverEnv(): FingerprintEnv {
  return typeof process === 'undefined' ? {} : process.env;
}
