import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { OWNER_GUARD_KEY } from '../decorators/owner-guard.decorator';
import { OwnerGuardGuard } from './owner-guard.guard';
import {
  OwnerGuardPublicConflictException,
  OwnerGuardUserMissingException,
} from './owner-guard.exceptions';

type Metadata = { ownerGuard?: boolean; isPublic?: boolean };

function makeContext(
  metadata: Metadata,
  request: { user?: { id?: string } } = {},
): { context: ExecutionContext; reflector: Reflector } {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
    if (key === OWNER_GUARD_KEY) return metadata.ownerGuard as never;
    if (key === IS_PUBLIC_KEY) return metadata.isPublic as never;
    return undefined as never;
  });

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

describe('OwnerGuardGuard', () => {
  describe('no @OwnerGuard() metadata', () => {
    it('returns true without inspecting req.user', () => {
      const { context, reflector } = makeContext({ ownerGuard: undefined });
      const guard = new OwnerGuardGuard(reflector);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('returns true even when req.user is missing (short-circuits before user lookup)', () => {
      const { context, reflector } = makeContext({ ownerGuard: false }, {});
      const guard = new OwnerGuardGuard(reflector);
      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('@OwnerGuard() + @Public() collision (paradoxical configuration)', () => {
    it('throws OwnerGuardPublicConflictException', () => {
      const { context, reflector } = makeContext(
        { ownerGuard: true, isPublic: true },
        { user: { id: 'user-abc' } },
      );
      const guard = new OwnerGuardGuard(reflector);
      expect(() => guard.canActivate(context)).toThrow(OwnerGuardPublicConflictException);
    });

    it('carries the OWNER_GUARD_PUBLIC_CONFLICT code in the response envelope', () => {
      const { context, reflector } = makeContext(
        { ownerGuard: true, isPublic: true },
        { user: { id: 'user-abc' } },
      );
      const guard = new OwnerGuardGuard(reflector);
      try {
        guard.canActivate(context);
        fail('expected guard to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OwnerGuardPublicConflictException);
        expect((err as OwnerGuardPublicConflictException).getResponse()).toMatchObject({
          error: { code: 'OWNER_GUARD_PUBLIC_CONFLICT' },
        });
      }
    });
  });

  describe('@OwnerGuard() set + missing or falsy req.user.id', () => {
    it('throws OwnerGuardUserMissingException when req.user is undefined', () => {
      const { context, reflector } = makeContext({ ownerGuard: true }, {});
      const guard = new OwnerGuardGuard(reflector);
      expect(() => guard.canActivate(context)).toThrow(OwnerGuardUserMissingException);
    });

    it('throws OwnerGuardUserMissingException when req.user.id is an empty string', () => {
      const { context, reflector } = makeContext({ ownerGuard: true }, { user: { id: '' } });
      const guard = new OwnerGuardGuard(reflector);
      expect(() => guard.canActivate(context)).toThrow(OwnerGuardUserMissingException);
    });

    it('carries the OWNER_GUARD_USER_MISSING code in the response envelope', () => {
      const { context, reflector } = makeContext({ ownerGuard: true }, {});
      const guard = new OwnerGuardGuard(reflector);
      try {
        guard.canActivate(context);
        fail('expected guard to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(OwnerGuardUserMissingException);
        expect((err as OwnerGuardUserMissingException).getResponse()).toMatchObject({
          error: { code: 'OWNER_GUARD_USER_MISSING' },
        });
      }
    });
  });

  describe('@OwnerGuard() set + hydrated req.user.id', () => {
    it('returns true and delegates ownership-match to the service layer', () => {
      const { context, reflector } = makeContext(
        { ownerGuard: true },
        { user: { id: 'user-abc' } },
      );
      const guard = new OwnerGuardGuard(reflector);
      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
