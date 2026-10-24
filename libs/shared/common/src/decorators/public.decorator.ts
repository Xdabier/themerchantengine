import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public — bypasses JwtAuthGuard.
 * Usage: @Public() on a controller method or class.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
