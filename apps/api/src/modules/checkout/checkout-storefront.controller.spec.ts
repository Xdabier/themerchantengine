import { IS_PUBLIC_KEY, OWNER_GUARD_KEY, PERMISSIONS_KEY } from '@common/decorators';
import { PUBLIC_CACHEABLE_KEY } from '@common/decorators';
import { CheckoutController } from './checkout.controller';
import { CheckoutStorefrontController } from './checkout-storefront.controller';

/**
 * Decorator audit for the public checkout surface.
 *
 * This is the only anonymous route in the checkout module, and the reason it
 * exists is that the settings and the tender list were unreachable from the
 * storefront. Widening it further, or narrowing it back, both break something
 * a customer sees, so the decoration is pinned here rather than left to review.
 */
describe('CheckoutStorefrontController — decorator audit', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = CheckoutStorefrontController.prototype as any;

  it('GET /v1/checkout/settings is @Public()', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.getSettings)).toBe(true);
  });

  it('carries no admin @Permissions()', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, proto.getSettings)).toBeUndefined();
  });

  it('carries no @OwnerGuard()', () => {
    // `OwnerGuardGuard` throws OWNER_GUARD_PUBLIC_CONFLICT when a handler is
    // both public and owner-guarded, and OWNER_GUARD_USER_MISSING on every
    // anonymous request otherwise. Either one takes the route down for the
    // exact visitor it was built for.
    expect(Reflect.getMetadata(OWNER_GUARD_KEY, proto.getSettings)).toBeFalsy();
  });

  it('is not cacheable — a settings flip has to apply on the next request', () => {
    expect(Reflect.getMetadata(PUBLIC_CACHEABLE_KEY, proto.getSettings)).toBeUndefined();
  });

  it('leaves the admin controller admin-gated', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = CheckoutController.prototype as any;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, admin.getSettings)).toEqual(['checkout:view']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, admin.updateSettings)).toEqual(['checkout:manage']);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, admin.getSettings)).toBeFalsy();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, admin.updateSettings)).toBeFalsy();
  });
});
