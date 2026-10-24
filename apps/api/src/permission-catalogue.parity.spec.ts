import { PERMISSION_ACTIONS, PERMISSION_MODULES, PERMISSION_STRINGS } from '@permissions';
import {
  PERMISSION_ACTIONS as SEED_ACTIONS,
  PERMISSION_MODULES as SEED_MODULES,
  PERMISSION_STRINGS as SEED_STRINGS,
} from '../../../prisma/permission-catalogue';

/**
 * The prod runtime image copies `prisma/` but not `libs/` (apps/api/Dockerfile),
 * so `prisma/seed.ts` cannot import `@permissions`. It carries a hand-maintained
 * copy instead. This spec is the guard that keeps the copy honest: edit one file
 * without the other and `npx nx test api` goes red.
 */
describe('prisma/permission-catalogue parity with @permissions', () => {
  it('declares the same modules in the same order', () => {
    expect([...SEED_MODULES]).toEqual([...PERMISSION_MODULES]);
  });

  it('declares the same actions in the same order', () => {
    expect([...SEED_ACTIONS]).toEqual([...PERMISSION_ACTIONS]);
  });

  it('derives the same 130 permission strings', () => {
    expect([...SEED_STRINGS]).toEqual([...PERMISSION_STRINGS]);
  });
});
