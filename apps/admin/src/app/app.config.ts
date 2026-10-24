import {
  ApplicationConfig,
  ErrorHandler,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ADMIN_API_BASE_URL } from '@admin-services';
import { ASSET_PICKER_PERMISSIONS } from '@admin-ui/organisms/asset-picker/asset-picker.token';
import { TRANSLATABLE_LOCALES } from '@admin-ui/atoms/translatable-locales.token';
import { appRoutes } from './app.routes';
import { environment } from '../environments/environment';
import {
  acceptLanguageInterceptor,
  correlationIdInterceptor,
  credentialsInterceptor,
  errorNormalizerInterceptor,
  requestedWithInterceptor,
} from './core/interceptors';
import { GlobalErrorHandler } from './core/global-error-handler';
import { StoreTitleStrategy } from './core/store-title-strategy';
import { provideSessionBootstrap } from './core/session-bootstrap';
import { AuthStore } from './core/stores/auth.store';
import { StoreSettingsStore } from './core/stores/store-settings.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      appRoutes,
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    // Puts the store's own name in the browser tab. Reads `data.title`, which
    // is where every route in this app declares its screen name.
    { provide: TitleStrategy, useClass: StoreTitleStrategy },
    provideHttpClient(
      withFetch(),
      withInterceptors([
        correlationIdInterceptor,
        acceptLanguageInterceptor,
        requestedWithInterceptor,
        credentialsInterceptor,
        errorNormalizerInterceptor,
      ]),
    ),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    { provide: ADMIN_API_BASE_URL, useValue: environment.apiBaseUrl },
    {
      provide: ASSET_PICKER_PERMISSIONS,
      useFactory: (auth: AuthStore) => auth.permissions,
      deps: [AuthStore],
    },
    {
      // Every Translatable editor reads its tab list from here. Both tokens are
      // imported by deep path rather than from the `@admin-ui` barrel: the
      // barrel would pull every atom and organism into the initial chunk, which
      // has under 100 kB of headroom against its error budget.
      provide: TRANSLATABLE_LOCALES,
      useFactory: (settings: StoreSettingsStore) => settings.localeTabs,
      deps: [StoreSettingsStore],
    },
    provideSessionBootstrap(),
  ],
};
