/**
 * Mirror of the users created by `prisma/seed.ts`.
 *
 * When the seed changes, update this catalog (and any specs that depend on
 * specific permission boundaries). Passwords are intentionally plain-text here
 * because the seed intentionally uses fixed credentials for test determinism.
 */
export const TEST_USERS = {
  superAdmin: {
    email: 'superadmin@merchants.test',
    password: 'Admin123!',
    role: 'SUPER_ADMIN' as const,
  },
  admin: {
    email: 'admin@merchants.test',
    password: 'password123',
    role: 'SUPER_ADMIN' as const,
  },
  manager: {
    email: 'manager@merchants.test',
    password: 'Admin123!',
    role: 'MANAGER' as const,
  },
  support: {
    email: 'support@merchants.test',
    password: 'Admin123!',
    role: 'SUPPORT' as const,
  },
  staff: {
    email: 'staff@merchants.test',
    password: 'password123',
    role: 'ADMIN' as const,
  },
} satisfies Record<string, { email: string; password: string; role: string }>;

export type TestUserKey = keyof typeof TEST_USERS;
