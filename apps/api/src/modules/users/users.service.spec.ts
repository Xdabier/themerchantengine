import * as bcrypt from 'bcrypt';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

// The email-change security fix routes through Better Auth's verified
// change-email flow; mock the module-level singleton.
jest.mock('../../auth/auth', () => ({ auth: { api: { changeEmail: jest.fn() } } }));

import { UsersService } from './users.service';
import { StaffRole } from './dto';
import { USER_EVENTS } from './users.constants';
import { auth } from '../../auth/auth';

const changeEmailMock = auth.api.changeEmail as jest.Mock;

// ── Mock helpers ─────────────────────────────────────────────────────────────

function makePrismaService() {
  const txMock = {
    user: {
      create: jest.fn(),
      update: jest.fn(),
    },
    address: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
      update: jest.fn(),
    },
    account: {
      create: jest.fn(),
      update: jest.fn(),
    },
    session: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    rolePermission: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    role: {
      update: jest.fn(),
    },
  };

  return {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    address: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    role: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    rolePermission: {
      deleteMany: jest.fn(),
    },
    account: {
      findFirst: jest.fn(),
    },
    session: {
      deleteMany: jest.fn(),
    },
    order: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return arg(txMock);
      }
      // Array form
      return Promise.all(arg as Promise<unknown>[]);
    }),
    _txMock: txMock,
  };
}

const USER_ID = 'user-1';
const ADDRESS_ID = 'addr-1';

const mockUser = {
  id: USER_ID,
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  phone: null,
  avatarUrl: null,
  role: 'CUSTOMER',
  isActive: true,
  emailVerified: false,
  phoneVerified: false,
  passwordHash: '',
  roleId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  addresses: [],
};

const mockAddress = {
  id: ADDRESS_ID,
  userId: USER_ID,
  label: 'Home',
  fullName: 'Test User',
  phone: '+1234567890',
  addressLine1: '123 Main St',
  addressLine2: null,
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
  isDefaultShipping: false,
  isDefaultBilling: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof makePrismaService>;
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    mockUser.passwordHash = await bcrypt.hash('Password1', 4);
    prisma = makePrismaService();
    events = { emit: jest.fn() };
    changeEmailMock.mockReset().mockResolvedValue({ status: true });
    service = new UsersService(prisma as any, events as any);
  });

  // ── getProfile ─────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns user without passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = (await service.getProfile(USER_ID)) as Record<string, unknown>;

      expect(result.id).toBe(USER_ID);
      expect(result.email).toBe('test@example.com');
      expect('passwordHash' in result).toBe(false);
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile(USER_ID)).rejects.toThrow(NotFoundException);
    });

    // Resend webhook ops state and the soft-delete column are operational
    // plumbing, not profile fields (plan J, sweep S4).
    it('drops the mail-ops state and deletedAt', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        emailDeliverability: 'bounced',
        emailBouncedAt: new Date(),
        emailComplainedAt: new Date(),
      });

      const result = (await service.getProfile(USER_ID)) as Record<string, unknown>;

      expect(result).not.toHaveProperty('emailDeliverability');
      expect(result).not.toHaveProperty('emailBouncedAt');
      expect(result).not.toHaveProperty('emailComplainedAt');
      expect(result).not.toHaveProperty('deletedAt');
    });

    // This endpoint also feeds the admin dashboard session bootstrap, so the
    // strip must not touch what `AdminUser` needs.
    it('keeps the admin bootstrap shape intact', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        role: 'ADMIN',
        twoFactorEnabled: true,
        customRole: {
          id: 'role-1',
          name: 'Manager',
          permissions: [{ permission: 'orders:view' }],
        },
      });

      const result = (await service.getProfile(USER_ID)) as Record<string, unknown>;

      expect(result['roles']).toEqual([
        { id: 'role-1', name: 'Manager', permissions: ['orders:view'] },
      ]);
      expect(result['twoFactorEnabled']).toBe(true);
      expect(result['isActive']).toBe(true);
      expect(result['role']).toBe('ADMIN');
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('updates firstName and lastName without password check', async () => {
      prisma._txMock.user.update.mockResolvedValue({ ...mockUser, firstName: 'Updated' });

      const result = (await service.updateProfile(USER_ID, { firstName: 'Updated' })) as Record<
        string,
        unknown
      >;

      expect(prisma._txMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({ firstName: 'Updated' }),
        }),
      );
      expect('passwordHash' in result).toBe(false);
    });

    it('strips the mail-ops state from the update response too (plan J)', async () => {
      prisma._txMock.user.update.mockResolvedValue({
        ...mockUser,
        firstName: 'Updated',
        emailDeliverability: 'bounced',
        emailBouncedAt: new Date(),
        emailComplainedAt: new Date(),
      });

      const result = (await service.updateProfile(USER_ID, { firstName: 'Updated' })) as Record<
        string,
        unknown
      >;

      expect(result['firstName']).toBe('Updated');
      expect(result).not.toHaveProperty('emailDeliverability');
      expect(result).not.toHaveProperty('emailBouncedAt');
      expect(result).not.toHaveProperty('emailComplainedAt');
      expect(result).not.toHaveProperty('deletedAt');
    });

    it('requires currentPassword when changing email', async () => {
      await expect(service.updateProfile(USER_ID, { email: 'new@example.com' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('requires currentPassword when changing password', async () => {
      await expect(service.updateProfile(USER_ID, { newPassword: 'NewPass1!' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('requires currentPassword when changing phone (spec §8.2)', async () => {
      await expect(service.updateProfile(USER_ID, { phone: '+9715551234' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws UnauthorizedException when currentPassword is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.account.findFirst.mockResolvedValue({ id: 'cred-1', password: mockUser.passwordHash });

      await expect(
        service.updateProfile(USER_ID, {
          email: 'new@example.com',
          currentPassword: 'WrongPass1',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('routes an email change through Better Auth and never writes email directly (NE5 security fix)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.account.findFirst.mockResolvedValue({ id: 'cred-1', password: mockUser.passwordHash });
      prisma.user.findFirst.mockResolvedValue(null);
      prisma._txMock.user.update.mockResolvedValue(mockUser);

      await service.updateProfile(
        USER_ID,
        { email: 'new@example.com', currentPassword: 'Password1' },
        { cookie: 'better-auth.session_token=abc' } as Record<string, string>,
      );

      // The new email is NOT committed directly — it goes to Better Auth's
      // verified change-email flow with the caller's headers.
      expect(changeEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: { newEmail: 'new@example.com' } }),
      );
      const updateCall = prisma._txMock.user.update.mock.calls[0]?.[0] as
        | { data: Record<string, unknown> }
        | undefined;
      expect(updateCall?.data).not.toHaveProperty('email');
    });

    it('does not route an email change when the email is unchanged', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.account.findFirst.mockResolvedValue({ id: 'cred-1', password: mockUser.passwordHash });
      prisma._txMock.user.update.mockResolvedValue(mockUser);

      await service.updateProfile(
        USER_ID,
        { email: mockUser.email, currentPassword: 'Password1' },
        {} as Record<string, string>,
      );

      expect(changeEmailMock).not.toHaveBeenCalled();
    });

    it('throws ConflictException when new email is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.account.findFirst.mockResolvedValue({ id: 'cred-1', password: mockUser.passwordHash });
      prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });

      await expect(
        service.updateProfile(USER_ID, {
          email: 'taken@example.com',
          currentPassword: 'Password1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('writes newPassword to the credential Account and revokes sessions', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.account.findFirst.mockResolvedValue({ id: 'cred-1', password: mockUser.passwordHash });
      prisma._txMock.user.update.mockResolvedValue(mockUser);

      await service.updateProfile(USER_ID, {
        newPassword: 'NewSecure1',
        currentPassword: 'Password1',
      });

      // The new password is written to the Better Auth credential Account,
      // not User.passwordHash.
      const accountUpdate = prisma._txMock.account.update.mock.calls[0][0] as {
        data: { password: string };
      };
      expect(await bcrypt.compare('NewSecure1', accountUpdate.data.password)).toBe(true);
      // Every Better Auth session is revoked after a password change.
      expect(prisma._txMock.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });

    it('emits a password-changed security alert after a password change (NE5)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.account.findFirst.mockResolvedValue({ id: 'cred-1', password: mockUser.passwordHash });
      prisma._txMock.user.update.mockResolvedValue(mockUser);

      await service.updateProfile(USER_ID, {
        newPassword: 'NewSecure1',
        currentPassword: 'Password1',
      });

      expect(events.emit).toHaveBeenCalledWith(USER_EVENTS.PASSWORD_CHANGED, { userId: USER_ID });
    });

    it('on a combined email + password change, routes the email BEFORE revoking sessions (NE5)', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.account.findFirst.mockResolvedValue({ id: 'cred-1', password: mockUser.passwordHash });
      prisma.user.findFirst.mockResolvedValue(null);
      prisma._txMock.user.update.mockResolvedValue(mockUser);

      await service.updateProfile(
        USER_ID,
        { email: 'new@example.com', newPassword: 'NewSecure1', currentPassword: 'Password1' },
        { cookie: 'better-auth.session_token=abc' } as Record<string, string>,
      );

      // The email change must be dispatched while the caller's session is still
      // valid — i.e. BEFORE the password change revokes every session. Asserting
      // invocation order directly catches the ordering bug.
      expect(changeEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: { newEmail: 'new@example.com' } }),
      );
      expect(prisma._txMock.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
      const changeOrder = changeEmailMock.mock.invocationCallOrder[0];
      const revokeOrder = prisma._txMock.session.deleteMany.mock.invocationCallOrder[0];
      expect(changeOrder).toBeLessThan(revokeOrder);

      // The password change still commits + the alert still fires.
      expect(prisma._txMock.account.update).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith(USER_EVENTS.PASSWORD_CHANGED, { userId: USER_ID });
    });

    it('persists locale without requiring currentPassword', async () => {
      prisma._txMock.user.update.mockResolvedValue({ ...mockUser, locale: 'fr' });

      await service.updateProfile(USER_ID, { locale: 'fr' });

      expect(prisma._txMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({ locale: 'fr' }),
        }),
      );
    });
  });

  // ── createAddress ──────────────────────────────────────────────────────

  describe('createAddress', () => {
    const createDto = {
      fullName: 'Test User',
      phone: '+1234567890',
      addressLine1: '123 Main St',
      city: 'Springfield',
      country: 'US',
    };

    it('creates address without default flags outside a transaction', async () => {
      prisma.address.create.mockResolvedValue(mockAddress);

      await service.createAddress(USER_ID, createDto);

      expect(prisma.address.create).toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('uses $transaction when isDefaultShipping is true', async () => {
      prisma._txMock.address.create.mockResolvedValue({
        ...mockAddress,
        isDefaultShipping: true,
      });

      await service.createAddress(USER_ID, { ...createDto, isDefaultShipping: true });

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('unsets previous default shipping before setting new one', async () => {
      prisma._txMock.address.create.mockResolvedValue({
        ...mockAddress,
        isDefaultShipping: true,
      });

      await service.createAddress(USER_ID, { ...createDto, isDefaultShipping: true });

      expect(prisma._txMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, isDefaultShipping: true },
        data: { isDefaultShipping: false },
      });
    });

    it('uses $transaction when isDefaultBilling is true', async () => {
      prisma._txMock.address.create.mockResolvedValue({
        ...mockAddress,
        isDefaultBilling: true,
      });

      await service.createAddress(USER_ID, { ...createDto, isDefaultBilling: true });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma._txMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, isDefaultBilling: true },
        data: { isDefaultBilling: false },
      });
    });
  });

  // ── updateAddress ──────────────────────────────────────────────────────

  describe('updateAddress', () => {
    beforeEach(() => {
      prisma.address.findUnique.mockResolvedValue({ userId: USER_ID });
    });

    it('throws ForbiddenException when address belongs to another user', async () => {
      prisma.address.findUnique.mockResolvedValue({ userId: 'other-user' });

      await expect(service.updateAddress(USER_ID, ADDRESS_ID, { city: 'Chicago' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when address does not exist', async () => {
      prisma.address.findUnique.mockResolvedValue(null);

      await expect(service.updateAddress(USER_ID, ADDRESS_ID, { city: 'Chicago' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates address fields without transaction when no default change', async () => {
      prisma.address.update.mockResolvedValue({ ...mockAddress, city: 'Chicago' });

      await service.updateAddress(USER_ID, ADDRESS_ID, { city: 'Chicago' });

      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: ADDRESS_ID },
        data: { city: 'Chicago' },
      });
    });

    it('uses $transaction when setting isDefaultShipping', async () => {
      prisma._txMock.address.update.mockResolvedValue({
        ...mockAddress,
        isDefaultShipping: true,
      });

      await service.updateAddress(USER_ID, ADDRESS_ID, { isDefaultShipping: true });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma._txMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, isDefaultShipping: true, NOT: { id: ADDRESS_ID } },
        data: { isDefaultShipping: false },
      });
    });
  });

  // ── deleteAddress ──────────────────────────────────────────────────────

  describe('deleteAddress', () => {
    it('deletes address when ownership is valid', async () => {
      prisma.address.findUnique.mockResolvedValue({ userId: USER_ID });
      prisma.address.delete.mockResolvedValue(mockAddress);

      await service.deleteAddress(USER_ID, ADDRESS_ID);

      expect(prisma.address.delete).toHaveBeenCalledWith({ where: { id: ADDRESS_ID } });
    });

    it('throws ForbiddenException when address belongs to another user', async () => {
      prisma.address.findUnique.mockResolvedValue({ userId: 'other-user' });

      await expect(service.deleteAddress(USER_ID, ADDRESS_ID)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for non-existent address', async () => {
      prisma.address.findUnique.mockResolvedValue(null);

      await expect(service.deleteAddress(USER_ID, ADDRESS_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── setDefaultAddress ──────────────────────────────────────────────────

  describe('setDefaultAddress', () => {
    beforeEach(() => {
      prisma.address.findUnique.mockResolvedValue({ userId: USER_ID });
      prisma._txMock.address.update.mockResolvedValue({
        ...mockAddress,
        isDefaultShipping: true,
      });
    });

    it('throws ADDRESS_DEFAULT_FLAG_REQUIRED when neither flag is true', async () => {
      await expect(service.setDefaultAddress(USER_ID, ADDRESS_ID, {})).rejects.toMatchObject({
        response: { error: { code: 'ADDRESS_DEFAULT_FLAG_REQUIRED' } },
      });
    });

    it('atomically unsets previous default shipping and sets new one', async () => {
      await service.setDefaultAddress(USER_ID, ADDRESS_ID, { isDefaultShipping: true });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma._txMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, isDefaultShipping: true, NOT: { id: ADDRESS_ID } },
        data: { isDefaultShipping: false },
      });
      expect(prisma._txMock.address.update).toHaveBeenCalledWith({
        where: { id: ADDRESS_ID },
        data: { isDefaultShipping: true },
      });
    });

    it('atomically unsets previous default billing and sets new one', async () => {
      prisma._txMock.address.update.mockResolvedValue({
        ...mockAddress,
        isDefaultBilling: true,
      });

      await service.setDefaultAddress(USER_ID, ADDRESS_ID, { isDefaultBilling: true });

      expect(prisma._txMock.address.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, isDefaultBilling: true, NOT: { id: ADDRESS_ID } },
        data: { isDefaultBilling: false },
      });
    });

    it('can set both defaults simultaneously', async () => {
      prisma._txMock.address.update.mockResolvedValue({
        ...mockAddress,
        isDefaultShipping: true,
        isDefaultBilling: true,
      });

      await service.setDefaultAddress(USER_ID, ADDRESS_ID, {
        isDefaultShipping: true,
        isDefaultBilling: true,
      });

      expect(prisma._txMock.address.updateMany).toHaveBeenCalledTimes(2);
    });
  });

  // ── listCustomers ──────────────────────────────────────────────────────

  describe('listCustomers', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
      prisma.user.findMany.mockResolvedValue([mockUser]);
      prisma.user.count.mockResolvedValue(1);
    });

    it('returns paginated result with correct meta', async () => {
      const result = await service.listCustomers({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('applies search filter across firstName, lastName, and email', async () => {
      await service.listCustomers({ search: 'john' });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ firstName: expect.any(Object) }),
              expect.objectContaining({ lastName: expect.any(Object) }),
              expect.objectContaining({ email: expect.any(Object) }),
            ]),
          }),
        }),
      );
    });

    it('calculates correct skip for page 2', async () => {
      await service.listCustomers({ page: 2, pageSize: 10 });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    // ── Plan F, findings F3 + F4 ────────────────────────────────────────

    it('flattens Prisma _count.orders into orderCount', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...mockUser, _count: { orders: 2 } }]);

      const result = await service.listCustomers({});
      const rows = result.data as Array<{ orderCount: number }>;

      expect(rows[0].orderCount).toBe(2);
    });

    it('sums collected order totals into totalSpent', async () => {
      prisma.user.findMany.mockResolvedValue([{ ...mockUser, _count: { orders: 2 } }]);
      prisma.order.groupBy.mockImplementation((args: { _sum?: unknown }) =>
        Promise.resolve(args._sum ? [{ userId: USER_ID, _sum: { total: '250.50' } }] : []),
      );

      const result = await service.listCustomers({});
      const rows = result.data as Array<{ totalSpent: number }>;

      expect(rows[0].totalSpent).toBe(250.5);
      expect(prisma.order.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paymentStatus: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] },
          }),
        }),
      );
    });

    it('derives ACTIVE from an unpaid recent order, not from collected revenue', async () => {
      const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      prisma.user.findMany.mockResolvedValue([{ ...mockUser, _count: { orders: 1 } }]);
      // No captured payment at all: the lifetime aggregate is empty while the
      // payment-unfiltered recency aggregate still reports the order.
      prisma.order.groupBy.mockImplementation((args: { _max?: unknown }) =>
        Promise.resolve(args._max ? [{ userId: USER_ID, _max: { createdAt: recent } }] : []),
      );

      const result = await service.listCustomers({});
      const rows = result.data as Array<{ segment: string | null; totalSpent: number }>;

      expect(rows[0].segment).toBe('ACTIVE');
      expect(rows[0].totalSpent).toBe(0);
    });

    it('prefers LOYAL over ACTIVE when both cohorts match', async () => {
      const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      prisma.user.findMany.mockResolvedValue([
        { ...mockUser, createdAt: old, _count: { orders: 4 } },
      ]);
      prisma.order.groupBy.mockImplementation((args: { _max?: unknown; _count?: unknown }) => {
        if (args._max) return Promise.resolve([{ userId: USER_ID, _max: { createdAt: recent } }]);
        if (args._count) return Promise.resolve([{ userId: USER_ID, _count: { _all: 2 } }]);
        return Promise.resolve([]);
      });

      const result = await service.listCustomers({});
      const rows = result.data as Array<{ segment: string | null }>;

      expect(rows[0].segment).toBe('LOYAL');
    });

    it('derives NEW for a fresh account with no orders', async () => {
      prisma.user.findMany.mockResolvedValue([
        { ...mockUser, createdAt: new Date(), _count: { orders: 0 } },
      ]);

      const result = await service.listCustomers({});
      const rows = result.data as Array<{ segment: string | null }>;

      expect(rows[0].segment).toBe('NEW');
    });

    it('applies the ACTIVE predicate to the WHERE when segment is given', async () => {
      await service.listCustomers({ segment: 'ACTIVE' as never });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [{ orders: { some: { createdAt: { gte: expect.any(Date) } } } }],
          }),
        }),
      );
    });

    it('matches nobody for the criteria-less VIP segment', async () => {
      await service.listCustomers({ segment: 'VIP' as never });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ AND: [{ id: { in: [] } }] }) }),
      );
    });
  });

  describe('listCustomerSegments', () => {
    it('still returns the same five cohorts after the predicate extraction', async () => {
      prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
      prisma.user.count.mockResolvedValue(3);

      const result = await service.listCustomerSegments();

      expect(result.map((r) => r.segment)).toEqual([
        'NEW',
        'ACTIVE',
        'LOYAL',
        'AT_RISK',
        'CHURNED',
      ]);
      expect(result.every((r) => r.count === 3)).toBe(true);
    });
  });

  // ── getCustomerById ────────────────────────────────────────────────────

  describe('getCustomerById', () => {
    it('returns customer without passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        role: 'CUSTOMER',
        _count: { orders: 0, reviews: 0, returns: 0 },
      });

      const result = (await service.getCustomerById('user-1')) as Record<string, unknown>;

      expect(result.id).toBe(USER_ID);
      expect('passwordHash' in result).toBe(false);
    });

    it('carries the flattened counts, lifetime value, and segment', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        role: 'CUSTOMER',
        _count: { orders: 2, reviews: 3, returns: 1 },
      });
      prisma.order.groupBy.mockImplementation((args: { _sum?: unknown }) =>
        Promise.resolve(args._sum ? [{ userId: USER_ID, _sum: { total: '99' } }] : []),
      );

      const result = (await service.getCustomerById(USER_ID)) as Record<string, unknown>;

      expect(result.orderCount).toBe(2);
      expect(result.reviewCount).toBe(3);
      expect(result.returnCount).toBe(1);
      expect(result.totalSpent).toBe(99);
      expect('segment' in result).toBe(true);
    });

    it('throws NotFoundException for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getCustomerById('unknown')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when user is not a CUSTOMER role', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, role: 'ADMIN' });

      await expect(service.getCustomerById(USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── createStaff ────────────────────────────────────────────────────────

  describe('createStaff', () => {
    const staffDto = {
      email: 'staff@example.com',
      password: 'StrongPass1',
      firstName: 'Staff',
      lastName: 'Member',
      role: StaffRole.ADMIN,
    };

    it('creates a staff user with hashed password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma._txMock.user.create.mockResolvedValue({
        ...mockUser,
        email: staffDto.email,
        role: 'ADMIN',
        customRole: null,
      });

      const result = (await service.createStaff(staffDto)) as Record<string, unknown>;

      expect(prisma._txMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: staffDto.email,
            role: 'ADMIN',
          }),
        }),
      );
      expect('passwordHash' in result).toBe(false);
    });

    it('emits a staff-invited event so the new staff member is notified (NE5)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma._txMock.user.create.mockResolvedValue({
        ...mockUser,
        id: 'staff-9',
        email: staffDto.email,
        role: 'ADMIN',
      });

      await service.createStaff(staffDto);

      expect(events.emit).toHaveBeenCalledWith(USER_EVENTS.STAFF_INVITED, { userId: 'staff-9' });
    });

    it('throws ConflictException when email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.createStaff(staffDto)).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when roleId does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(service.createStaff({ ...staffDto, roleId: 'nonexistent' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates roleId exists when provided', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'Admin' });
      prisma._txMock.user.create.mockResolvedValue({
        ...mockUser,
        role: 'ADMIN',
        roleId: 'role-1',
        customRole: { id: 'role-1', name: 'Admin', permissions: [] },
      });

      await service.createStaff({ ...staffDto, roleId: 'role-1' });

      expect(prisma.role.findUnique).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    });
  });

  // ── updateStaff ────────────────────────────────────────────────────────

  describe('updateStaff', () => {
    const CALLER_ID = 'caller-1';

    it('updates staff user fields', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, role: 'ADMIN' });
      prisma._txMock.user.update.mockResolvedValue({
        ...mockUser,
        role: 'ADMIN',
        firstName: 'Updated',
        customRole: null,
      });

      const result = (await service.updateStaff(CALLER_ID, USER_ID, {
        firstName: 'Updated',
      })) as Record<string, unknown>;

      expect(result.firstName).toBe('Updated');
      expect('passwordHash' in result).toBe(false);
    });

    it('throws ForbiddenException when caller tries to update own record (self-escalation)', async () => {
      await expect(
        service.updateStaff(USER_ID, USER_ID, { role: StaffRole.ADMIN }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for CUSTOMER role user', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, role: 'CUSTOMER' });

      await expect(service.updateStaff(CALLER_ID, USER_ID, { firstName: 'Nope' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for SUPER_ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, role: 'SUPER_ADMIN' });

      await expect(service.updateStaff(CALLER_ID, USER_ID, { firstName: 'Nope' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStaff(CALLER_ID, 'unknown', { firstName: 'Nope' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deactivateStaff ────────────────────────────────────────────────────

  describe('deactivateStaff', () => {
    const CALLER_ID = 'caller-1';

    it('sets isActive to false and revokes all Better Auth sessions', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, role: 'ADMIN' });
      prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
      prisma.user.update.mockResolvedValue({});
      prisma.session.deleteMany.mockResolvedValue({ count: 2 });

      await service.deactivateStaff(CALLER_ID, USER_ID);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { isActive: false },
      });
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
    });

    it('throws ForbiddenException when caller tries to deactivate themselves', async () => {
      await expect(service.deactivateStaff(USER_ID, USER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for CUSTOMER user', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, role: 'CUSTOMER' });

      await expect(service.deactivateStaff(CALLER_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for SUPER_ADMIN', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, role: 'SUPER_ADMIN' });

      await expect(service.deactivateStaff(CALLER_ID, USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listStaff ──────────────────────────────────────────────────────────

  describe('listStaff', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
      prisma.user.findMany.mockResolvedValue([{ ...mockUser, role: 'ADMIN' }]);
      prisma.user.count.mockResolvedValue(1);
    });

    it('returns paginated staff list', async () => {
      const result = await service.listStaff({ page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('lists every back-office role, super admins included', async () => {
      await service.listStaff({});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: { in: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SUPPORT'] },
          }),
        }),
      );
    });

    it('filters by SUPER_ADMIN when asked', async () => {
      await service.listStaff({ role: 'SUPER_ADMIN' as never });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
      );
    });

    it('selects the role and customRole the ROLES column binds', async () => {
      await service.listStaff({});

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            role: true,
            isActive: true,
            customRole: { select: { id: true, name: true } },
          }),
        }),
      );
    });

    it('filters by specific role when provided', async () => {
      await service.listStaff({ role: 'MANAGER' as any });

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'MANAGER' }),
        }),
      );
    });
  });

  // ── createRole ─────────────────────────────────────────────────────────

  describe('createRole', () => {
    it('creates role with permissions', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.role.create.mockResolvedValue({
        id: 'role-1',
        name: 'Editor',
        description: null,
        permissions: [{ permission: 'products:view' }, { permission: 'products:update' }],
      });

      const result = await service.createRole({
        name: 'Editor',
        permissions: ['products:view', 'products:update'],
      });

      expect(prisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Editor',
            permissions: {
              create: [{ permission: 'products:view' }, { permission: 'products:update' }],
            },
          }),
        }),
      );
      expect(result.permissions).toHaveLength(2);
    });

    it('throws ConflictException when role name already exists', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'existing', name: 'Editor' });

      await expect(
        service.createRole({ name: 'Editor', permissions: ['products:view'] }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── updateRolePermissions ──────────────────────────────────────────────

  describe('updateRolePermissions', () => {
    it('replaces all permissions atomically via $transaction', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'Editor' });
      prisma._txMock.rolePermission.deleteMany.mockResolvedValue({ count: 2 });
      prisma._txMock.role.update.mockResolvedValue({
        id: 'role-1',
        name: 'Editor',
        permissions: [{ permission: 'orders:view' }],
      });

      const result = await service.updateRolePermissions('role-1', {
        permissions: ['orders:view'],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma._txMock.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { roleId: 'role-1' },
      });
      expect(result.permissions).toHaveLength(1);
    });

    it('throws NotFoundException when role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRolePermissions('unknown', { permissions: ['products:view'] }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── listRoles ──────────────────────────────────────────────────────────

  describe('listRoles', () => {
    it('returns all roles with permissions and user count', async () => {
      prisma.role.findMany.mockResolvedValue([
        {
          id: 'role-1',
          name: 'Admin',
          permissions: [{ permission: 'products:view' }],
          _count: { users: 3 },
        },
      ]);

      const result = await service.listRoles();

      expect(result).toHaveLength(1);
      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            permissions: expect.any(Object),
            _count: expect.any(Object),
          }),
        }),
      );
    });
  });
});
