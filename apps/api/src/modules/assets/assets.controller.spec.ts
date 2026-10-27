import 'reflect-metadata';
import { AssetsController } from './assets.controller';
import { PERMISSIONS_KEY } from '@common/decorators/permissions.decorator';
import { OWNER_GUARD_KEY } from '@common/decorators/owner-guard.decorator';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';

/**
 * Security audit for AssetsController.
 * Verifies decorator invariants without spinning up a full NestJS application.
 */
describe('AssetsController — security decorators', () => {
  const proto = AssetsController.prototype;

  describe('POST admin/assets/upload', () => {
    const handler = proto.uploadAsset;

    it('is guarded with assets:create permission', () => {
      const perms: string[] = Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? [];
      expect(perms).toContain('assets:create');
    });

    it('is NOT marked @Public', () => {
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler);
      expect(isPublic).toBeFalsy();
    });

    it('does NOT use @OwnerGuard (admin endpoint)', () => {
      const ownerGuard = Reflect.getMetadata(OWNER_GUARD_KEY, handler);
      expect(ownerGuard).toBeFalsy();
    });
  });

  describe('GET admin/assets/:id/references (S18 — DR-07)', () => {
    const handler = proto.getReferences;

    it('is guarded with assets:view permission', () => {
      const perms: string[] = Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? [];
      expect(perms).toContain('assets:view');
    });

    it('is NOT marked @Public', () => {
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler);
      expect(isPublic).toBeFalsy();
    });

    it('does NOT use @OwnerGuard (admin endpoint)', () => {
      const ownerGuard = Reflect.getMetadata(OWNER_GUARD_KEY, handler);
      expect(ownerGuard).toBeFalsy();
    });
  });

  describe('DELETE admin/assets/:id', () => {
    const handler = proto.remove;

    it('is guarded with assets:delete permission', () => {
      const perms: string[] = Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? [];
      expect(perms).toContain('assets:delete');
    });
  });

  describe('controller — references delegation', () => {
    it('returns the service payload directly (global interceptor wraps the data envelope)', () => {
      const fakeReferences = {
        products: [],
        variants: [],
        reviews: [],
        returns: [],
        categories: [],
        sections: [],
        total: 0,
      };
      const service = { getReferences: jest.fn().mockReturnValue(fakeReferences) };
      const controller = new AssetsController(service as never);
      const result = controller.getReferences('asset-1', {});
      expect(service.getReferences).toHaveBeenCalledWith('asset-1', {});
      expect(result).toBe(fakeReferences);
    });

    it('passes through type/page/pageSize filter to the service', () => {
      const refs = {
        products: [
          { kind: 'product' as const, id: 'p1', label: 'tee', route: '/products/p1/edit' },
        ],
        variants: [],
        reviews: [],
        returns: [],
        categories: [],
        sections: [],
        total: 1,
      };
      const service = { getReferences: jest.fn().mockReturnValue(refs) };
      const controller = new AssetsController(service as never);
      const filter = { type: 'product' as const, page: 2, pageSize: 10 };
      const result = controller.getReferences('asset-1', filter);
      expect(service.getReferences).toHaveBeenCalledWith('asset-1', filter);
      expect(result).toBe(refs);
    });
  });
});
