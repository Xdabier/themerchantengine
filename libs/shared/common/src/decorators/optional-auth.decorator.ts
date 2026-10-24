import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Marks a route as optionally authenticated.
 * If a valid Bearer token is present, req.user is set.
 * If no token or an invalid token is present, the request proceeds with req.user = undefined.
 *
 * Used for cart endpoints that serve both anonymous and authenticated users.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

/**
 * Overrides a class-level `@OptionalAuth()` on a specific handler, requiring a valid JWT.
 * Uses the same metadata key so `getAllAndOverride` returns `false` at handler level,
 * forcing the JwtAuthGuard to enforce authentication.
 */
export const RequireAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, false);
