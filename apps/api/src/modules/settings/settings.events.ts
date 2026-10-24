/**
 * Emitted after any write that can change the runtime store config
 * (`GET /v1/store/config`): a settings PATCH, the locales PATCH, a currency
 * roster write, a license verification. Listeners drop whatever they cached
 * from the config; the settings module owns no cache itself and may not
 * import the modules that do (§3.1), so the event is the only coupling.
 */
export const STORE_CONFIG_UPDATED_EVENT = 'store-config.updated';

export interface StoreConfigUpdatedPayload {
  /** Setting groups whose rows changed. Empty when the writer does not know. */
  groups: string[];
}
