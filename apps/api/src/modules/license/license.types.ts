// The claims schema, the file schema and the verdict shape are shared with the
// install stepper (`@common/license`); this module re-exports them for the
// controller, the service and the specs that import them from here.
export {
  licenseClaimsSchema,
  licenseFileSchema,
  type LicenseClaims,
  type LicenseFile,
  type LicenseVerdict,
} from '@common/license';
