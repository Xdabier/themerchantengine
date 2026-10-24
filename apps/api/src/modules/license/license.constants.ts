// The baked public key, the status vocabulary and the expiry windows are
// shared with the install stepper (`@common/license`) and re-exported here.
export {
  LICENSE_EXPIRING_DAYS,
  LICENSE_GRACE_DAYS,
  LICENSE_PUBLIC_KEY_PEM,
  LICENSE_STATUSES,
  type LicenseStatus,
} from '@common/license';

/** Path of the license file. Unset means no license was installed. */
export const LICENSE_FILE_ENV = 'LICENSE_FILE';

/**
 * Overrides the baked public key. For the test suites, which verify fixtures
 * signed by the test key whose public half is in `test/fixtures/license/`; a production
 * deployment never sets it.
 */
export const LICENSE_PUBLIC_KEY_ENV = 'LICENSE_PUBLIC_KEY_PEM';
