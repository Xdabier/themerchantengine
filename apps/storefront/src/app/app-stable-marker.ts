import {
  APP_BOOTSTRAP_LISTENER,
  ApplicationRef,
  DOCUMENT,
  PLATFORM_ID,
  type Provider,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const APP_STABLE_ATTRIBUTE = 'data-app-stable';

/**
 * Marks `<html>` once the browser app is stable.
 *
 * That is the moment event replay hands control to Angular's own listeners.
 * Before it, a click on a server-rendered link runs the browser's default
 * navigation and the component handler never sees it. The e2e
 * `waitForHydration` helper waits for this attribute: polling the DOM for
 * `ngh` and `jsaction` passed on WebKit while the app was still unstable.
 *
 * Listed after `provideClientHydration` so its listener registers after the
 * event replay one and fires after it on the same `whenStable`.
 */
export function provideAppStableMarker(): Provider {
  return {
    provide: APP_BOOTSTRAP_LISTENER,
    multi: true,
    useFactory: () => {
      const appRef = inject(ApplicationRef);
      const document = inject(DOCUMENT);
      const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
      return () => {
        if (!isBrowser) return;
        void appRef.whenStable().then(() => {
          if (appRef.destroyed) return;
          document.documentElement.setAttribute(APP_STABLE_ATTRIBUTE, '');
        });
      };
    },
  };
}
