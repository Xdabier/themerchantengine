// The custom JWT auth stack (controller, services, token service, JWT guard,
// DTOs) was retired in phase BA2 — authentication moved to Better Auth (DR-24).
// What remains here is the `module:action` RBAC `PermissionsGuard`, which the
// migration leaves unchanged.
export { PermissionsGuard } from './guards';
