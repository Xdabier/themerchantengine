import { InjectionToken, type Signal } from '@angular/core';

/**
 * DI token for the operator's permission set. Provided by the host app
 * (`apps/admin`) from `AuthStore.permissions()` so admin-ui stays decoupled
 * from app-level state. When unprovided (e.g. in standalone unit tests
 * that opt out of the upload tab), the picker treats the operator as
 * lacking `assets:create` and renders Browse-only.
 *
 * Declared in a separate lightweight file so `app.config.ts` can import only
 * the token without pulling `AssetPickerComponent` and its transitive
 * dependencies into the initial bundle (which would bust the 900 kB budget).
 */
export const ASSET_PICKER_PERMISSIONS = new InjectionToken<Signal<ReadonlySet<string>>>(
  'AssetPickerPermissions',
);
