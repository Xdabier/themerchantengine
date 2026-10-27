import { SetMetadata } from '@nestjs/common';

export const OWNER_GUARD_KEY = 'ownerGuard';

/**
 * Decorator to enable ownership verification on a route.
 * The route handler must have access to the resource owner ID through
 * the request context.
 */
export const OwnerGuard = () => SetMetadata(OWNER_GUARD_KEY, true);
