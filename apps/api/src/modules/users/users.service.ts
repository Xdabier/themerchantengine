import type { IncomingHttpHeaders } from 'http';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_EVENTS } from './users.constants';
import { deriveSegment, segmentWhere } from './users.segments';
import { ProfileCurrentPasswordRequiredException } from './profile-current-password-required.exception';
import { ProfileCurrentPasswordIncorrectException } from './profile-current-password-incorrect.exception';
import { ProfileEmailInUseException } from './profile-email-in-use.exception';
import { AddressDefaultFlagRequiredException } from './address-default-flag-required.exception';
import { CustomerNotFoundException } from './customer-not-found.exception';
import { StaffNotFoundException } from './staff-not-found.exception';
import { RoleNotFoundException } from './role-not-found.exception';
import { PaginatedResult } from '@common/interceptors/api-response.interceptor';
import {
  UpdateProfileDto,
  CreateAddressDto,
  UpdateAddressDto,
  SetDefaultAddressDto,
  ListCustomersQueryDto,
  CustomerSegment,
  UpdateCustomerAdminDto,
  CreateStaffDto,
  UpdateStaffDto,
  ListStaffQueryDto,
  LISTABLE_STAFF_ROLES,
  CreateRoleDto,
  UpdateRolePermissionsDto,
} from './dto';

const BCRYPT_ROUNDS = 12;

/**
 * `User` columns stripped from the `/v1/users/me` profile on top of
 * `passwordHash` (plan J, sweep S4).
 *
 * Resend webhook deliverability state plus the soft-delete column: operational
 * plumbing per §3.5, not profile fields. Exported so the customer-serializer
 * guard spec can classify every `User` column as kept or dropped.
 */
export const PROFILE_INTERNAL_FIELDS = [
  'emailDeliverability',
  'emailBouncedAt',
  'emailComplainedAt',
  'deletedAt',
] as const;

/**
 * Convert Node request headers to a Web `Headers` object for Better Auth's
 * server API. Built inline rather than importing `better-auth/node`'s
 * `fromNodeHeaders` — that subpath is ESM-only and breaks the CJS jest specs
 * that import this service. `Headers` is a Node 18+ global.
 */
function toWebHeaders(h?: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  if (h) {
    for (const [key, value] of Object.entries(h)) {
      if (value == null) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
  }
  return headers;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Customer: Profile ────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        addresses: { orderBy: { createdAt: 'asc' } },
        // Pull role + its granular permissions so the admin dashboard's
        // permissionGuard has something to match against. Customers don't
        // carry a custom role and pay nothing for the left join.
        customRole: { include: { permissions: true } },
      },
    });

    if (!user) {
      throw new NotFoundException({
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const sanitized = this.stripProfileInternals(this.sanitizeUser(user));
    const { customRole, ...rest } = sanitized;
    // Expose the custom role as a flat `roles: [{id, name, permissions: [...] }]`
    // array matching the shape the admin-types AdminUser schema expects, so
    // `effectivePermissions()` can union them with any direct permissions.
    return {
      ...rest,
      roles: customRole
        ? [
            {
              id: customRole.id,
              name: customRole.name,
              permissions: customRole.permissions.map((p) => p.permission),
            },
          ]
        : [],
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto, headers?: IncomingHttpHeaders) {
    const isChangingSensitive =
      dto.email !== undefined || dto.newPassword !== undefined || dto.phone !== undefined;

    // The verified bcrypt credential lives in the Better Auth `credential`
    // Account row; `User.passwordHash` is a vestigial pre-migration mirror
    // that Better Auth never reads.
    let credentialAccount: { id: string; password: string | null } | null = null;
    if (isChangingSensitive) {
      if (!dto.currentPassword) {
        throw new ProfileCurrentPasswordRequiredException();
      }

      credentialAccount = await this.prisma.account.findFirst({
        where: { userId, providerId: 'credential' },
        select: { id: true, password: true },
      });
      if (!credentialAccount?.password) {
        throw new BadRequestException({
          error: {
            code: 'USER_CREDENTIAL_CHANGE_FORBIDDEN',
            message: 'Cannot change credentials for this account type',
          },
        });
      }

      const valid = await bcrypt.compare(dto.currentPassword, credentialAccount.password);
      if (!valid) {
        throw new ProfileCurrentPasswordIncorrectException();
      }
    }

    // NE5 security fix: an email change is NEVER written directly here (the old
    // defect: a new login email committed after only a password check — no proof
    // of the new address, no notice to the old one). When `email` differs, the
    // change is routed through Better Auth's verified change-email flow below,
    // which mails a confirmation to the NEW address and (via the auth.ts
    // callback) a security alert to the OLD one. The email only commits once the
    // new address is confirmed.
    let emailChangeRequested = false;
    if (dto.email !== undefined) {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (current && dto.email !== current.email) {
        const conflict = await this.prisma.user.findFirst({
          where: { email: dto.email, NOT: { id: userId } },
        });
        if (conflict) {
          throw new ProfileEmailInUseException();
        }
        emailChangeRequested = true;
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    // NOTE: `email` is intentionally absent — see emailChangeRequested above.
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.locale !== undefined) data.locale = dto.locale;

    // A password change is written to the Better Auth `credential` Account,
    // not `User.passwordHash` — the Account is the credential of record.
    const newPasswordHash =
      dto.newPassword !== undefined ? await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS) : undefined;

    // Route a verified email change through Better Auth (NE5 security fix). This
    // runs BEFORE the transaction below: a password change in the same request
    // revokes every session (the caller's included), and auth.api.changeEmail
    // needs the caller's still-valid session in the forwarded headers — doing it
    // after the revoke would fail with a dead cookie. It mails a confirmation to
    // the NEW address + a security alert to the OLD one; the email only commits
    // once the new address is confirmed.
    if (emailChangeRequested && dto.email) {
      // Lazily import the Better Auth singleton: `better-auth` is ESM and
      // importing it at module load breaks the CJS jest specs that import this
      // service. Deferring it here keeps those specs loadable; jest.mock still
      // intercepts the dynamic import in this service's own spec.
      const { auth } = await import('../../auth/auth');
      await auth.api.changeEmail({
        body: { newEmail: dto.email },
        headers: toWebHeaders(headers),
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data });

      if (newPasswordHash !== undefined && credentialAccount) {
        await tx.account.update({
          where: { id: credentialAccount.id },
          data: { password: newPasswordHash },
        });
        // Revoke every Better Auth session for this user — the current one
        // included — so the password change forces a fresh sign-in everywhere.
        // This is intentionally harsher than Better Auth's built-in
        // `change-password` route (which keeps the current session): the
        // merchants-engine posture is "password change forces a fresh sign-in
        // everywhere, no exceptions" (BA5 audit H-2 — strictly more secure
        // than the Better Auth default, signed off in agent_docs/security.md
        // §"Password security"). The customer-facing storefront uses Better
        // Auth's own route directly and inherits the keep-current-session
        // default — only this admin profile-update path applies the harsher
        // policy.
        await tx.session.deleteMany({ where: { userId } });
      }

      return user;
    });

    // Password-changed security alert to the owner's address (NE5). Emitted
    // after the session-revoking transaction; never deduped (each change is a
    // distinct must-deliver alert).
    if (newPasswordHash !== undefined) {
      this.events.emit(USER_EVENTS.PASSWORD_CHANGED, { userId });
    }

    return this.stripProfileInternals(this.sanitizeUser(updated));
  }

  // ── Customer: Addresses ──────────────────────────────────────────────────

  async createAddress(userId: string, dto: CreateAddressDto) {
    const setShipping = dto.isDefaultShipping === true;
    const setBilling = dto.isDefaultBilling === true;

    if (setShipping || setBilling) {
      return this.prisma.$transaction(async (tx) => {
        if (setShipping) {
          await tx.address.updateMany({
            where: { userId, isDefaultShipping: true },
            data: { isDefaultShipping: false },
          });
        }
        if (setBilling) {
          await tx.address.updateMany({
            where: { userId, isDefaultBilling: true },
            data: { isDefaultBilling: false },
          });
        }
        return tx.address.create({
          data: {
            userId,
            label: dto.label,
            fullName: dto.fullName,
            phone: dto.phone,
            addressLine1: dto.addressLine1,
            addressLine2: dto.addressLine2,
            city: dto.city,
            state: dto.state,
            postalCode: dto.postalCode,
            country: dto.country,
            isDefaultShipping: setShipping,
            isDefaultBilling: setBilling,
          },
        });
      });
    }

    return this.prisma.address.create({
      data: {
        userId,
        label: dto.label,
        fullName: dto.fullName,
        phone: dto.phone,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        country: dto.country,
        isDefaultShipping: false,
        isDefaultBilling: false,
      },
    });
  }

  async updateAddress(userId: string, addressId: string, dto: UpdateAddressDto) {
    await this.assertAddressOwnership(userId, addressId);

    const setShipping = dto.isDefaultShipping === true;
    const setBilling = dto.isDefaultBilling === true;

    if (setShipping || setBilling) {
      return this.prisma.$transaction(async (tx) => {
        if (setShipping) {
          await tx.address.updateMany({
            where: { userId, isDefaultShipping: true, NOT: { id: addressId } },
            data: { isDefaultShipping: false },
          });
        }
        if (setBilling) {
          await tx.address.updateMany({
            where: { userId, isDefaultBilling: true, NOT: { id: addressId } },
            data: { isDefaultBilling: false },
          });
        }
        return tx.address.update({ where: { id: addressId }, data: dto });
      });
    }

    return this.prisma.address.update({ where: { id: addressId }, data: dto });
  }

  async deleteAddress(userId: string, addressId: string): Promise<void> {
    await this.assertAddressOwnership(userId, addressId);
    await this.prisma.address.delete({ where: { id: addressId } });
  }

  async setDefaultAddress(userId: string, addressId: string, dto: SetDefaultAddressDto) {
    if (!dto.isDefaultShipping && !dto.isDefaultBilling) {
      throw new AddressDefaultFlagRequiredException();
    }

    await this.assertAddressOwnership(userId, addressId);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefaultShipping) {
        await tx.address.updateMany({
          where: { userId, isDefaultShipping: true, NOT: { id: addressId } },
          data: { isDefaultShipping: false },
        });
      }
      if (dto.isDefaultBilling) {
        await tx.address.updateMany({
          where: { userId, isDefaultBilling: true, NOT: { id: addressId } },
          data: { isDefaultBilling: false },
        });
      }
      return tx.address.update({
        where: { id: addressId },
        data: {
          ...(dto.isDefaultShipping !== undefined && { isDefaultShipping: dto.isDefaultShipping }),
          ...(dto.isDefaultBilling !== undefined && { isDefaultBilling: dto.isDefaultBilling }),
        },
      });
    });
  }

  // ── Admin: Customers ─────────────────────────────────────────────────────

  async listCustomers(query: ListCustomersQueryDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const now = new Date();

    const where: Prisma.UserWhereInput = { role: 'CUSTOMER' };

    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // The segment chip used to be accepted and then silently dropped; it now
    // shares its predicate with the counts endpoint.
    if (query.segment) {
      where.AND = [segmentWhere(query.segment, now)];
    }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: await this.enrichCustomers(users, now),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Attaches the three columns the customer directory renders: a flat
   * `orderCount` (Prisma's `_count` nesting stays on the wire for
   * compatibility), `totalSpent`, and the derived `segment`. One aggregate per
   * input, keyed by the page's user ids, so the cost is three queries per page
   * rather than three per row.
   */
  private async enrichCustomers<
    T extends { id: string; createdAt: Date; _count?: { orders: number } | null },
  >(rows: T[], now: Date) {
    if (rows.length === 0) return [];
    const userIds = rows.map((r) => r.id);

    const [spend, recency, delivered] = await Promise.all([
      // Lifetime value counts money actually collected, nothing else.
      this.prisma.order.groupBy({
        by: ['userId'],
        where: {
          userId: { in: userIds },
          paymentStatus: { in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED] },
        },
        _sum: { total: true },
      }),
      // Recency and delivery stay payment-UNFILTERED: the cohort predicates
      // ignore payment status, so reusing the aggregate above would badge a
      // customer differently from the chip count that includes her.
      this.prisma.order.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _max: { createdAt: true },
      }),
      this.prisma.order.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: OrderStatus.DELIVERED },
        _count: { _all: true },
      }),
    ]);

    const spentBy = new Map(spend.map((r) => [r.userId, Number(r._sum.total ?? 0)]));
    const lastOrderBy = new Map(recency.map((r) => [r.userId, r._max.createdAt ?? null]));
    const deliveredBy = new Map(delivered.map((r) => [r.userId, r._count._all]));

    return rows.map((row) => {
      const orderCount = row._count?.orders ?? 0;
      return {
        ...row,
        orderCount,
        totalSpent: spentBy.get(row.id) ?? 0,
        segment: deriveSegment(
          {
            createdAt: row.createdAt,
            orderCount,
            lastOrderAt: lastOrderBy.get(row.id) ?? null,
            deliveredOrders: deliveredBy.get(row.id) ?? 0,
          },
          now,
        ),
      };
    });
  }

  async getCustomerById(customerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      include: {
        addresses: { orderBy: { createdAt: 'asc' } },
        _count: { select: { orders: true, reviews: true, returns: true } },
      },
    });

    if (!user || user.role !== 'CUSTOMER') {
      throw new CustomerNotFoundException();
    }

    const [enriched] = await this.enrichCustomers([user], new Date());

    return this.sanitizeUser({
      ...enriched,
      reviewCount: user._count.reviews,
      returnCount: user._count.returns,
    });
  }

  async updateCustomer(customerId: string, dto: UpdateCustomerAdminDto) {
    const user = await this.prisma.user.findUnique({ where: { id: customerId } });
    if (!user || user.role !== 'CUSTOMER') {
      throw new CustomerNotFoundException();
    }

    if (dto.email !== undefined && dto.email !== user.email) {
      const conflict = await this.prisma.user.findFirst({
        where: { email: dto.email, NOT: { id: customerId } },
      });
      if (conflict)
        throw new ConflictException({
          error: { code: 'CUSTOMER_EMAIL_IN_USE', message: 'Email already in use' },
        });
    }

    const updated = await this.prisma.user.update({
      where: { id: customerId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    return this.sanitizeUser(updated);
  }

  async listCustomerSegments() {
    const now = new Date();
    // Same predicates the list filter applies, so a chip's count always matches
    // the rows that chip selects.
    const cohorts = [
      CustomerSegment.NEW,
      CustomerSegment.ACTIVE,
      CustomerSegment.LOYAL,
      CustomerSegment.AT_RISK,
      CustomerSegment.CHURNED,
    ];

    const counts = await this.prisma.$transaction(
      cohorts.map((segment) =>
        this.prisma.user.count({ where: { role: 'CUSTOMER', ...segmentWhere(segment, now) } }),
      ),
    );

    return cohorts.map((segment, i) => ({ segment, count: counts[i] }));
  }

  // ── Admin: Staff ──────────────────────────────────────────────────────────

  async listStaff(query: ListStaffQueryDto): Promise<PaginatedResult<unknown>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    // SUPER_ADMIN rows are listed: this screen is the operator's answer to
    // "who holds back-office access", and hiding them under-reports it. The
    // mutation guards in updateStaff / deactivateStaff still refuse them.
    const where: Record<string, unknown> = {
      role: { in: LISTABLE_STAFF_ROLES },
    };
    if (query.role) {
      where.role = query.role;
    }

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
          customRole: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async createStaff(dto: CreateStaffDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException({
        error: { code: 'STAFF_EMAIL_IN_USE', message: 'Email already registered' },
      });
    }

    if (dto.roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
      if (!role) {
        throw new RoleNotFoundException();
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Create the User and its Better Auth `credential` Account atomically.
    // Better Auth's email/password sign-in reads the bcrypt hash from the
    // Account row, so a staff user created without one could never sign in.
    // `emailVerified` is set true: an operator vouches for the staff they
    // create, so there is no verification round-trip — and Better Auth's
    // `requireEmailVerification` would otherwise block the first sign-in.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          name: `${dto.firstName} ${dto.lastName}`,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role,
          emailVerified: true,
          ...(dto.roleId && { roleId: dto.roleId }),
        },
        include: {
          customRole: { include: { permissions: true } },
        },
      });
      await tx.account.create({
        data: {
          userId: created.id,
          accountId: created.id,
          providerId: 'credential',
          password: passwordHash,
        },
      });
      return created;
    });

    // NE5: notify the new staff member that an admin account was created for
    // them (invite notice — the admin set the password; Decision 3). Dispatched
    // off the event so createStaff stays decoupled from the mail module.
    this.events.emit(USER_EVENTS.STAFF_INVITED, { userId: user.id });

    return this.sanitizeUser(user);
  }

  async updateStaff(callerId: string, staffId: string, dto: UpdateStaffDto) {
    if (callerId === staffId) {
      throw new ForbiddenException({
        error: {
          code: 'STAFF_SELF_MODIFY_FORBIDDEN',
          message: 'Cannot modify your own staff record',
        },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: staffId } });
    if (!user || user.role === 'CUSTOMER' || user.role === 'SUPER_ADMIN') {
      throw new StaffNotFoundException();
    }

    if (dto.roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
      if (!role) {
        throw new RoleNotFoundException();
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.roleId !== undefined) data.roleId = dto.roleId;

    const roleChanging = dto.role !== undefined || dto.roleId !== undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: staffId },
        data,
        include: { customRole: { include: { permissions: true } } },
      });

      // Revoke this staff member's Better Auth sessions when the role
      // changes, so the new permission set takes effect on the next request
      // instead of waiting for the session to expire (spec §4 Scenario G).
      if (roleChanging) {
        await tx.session.deleteMany({ where: { userId: staffId } });
      }

      return user;
    });

    return this.sanitizeUser(updated);
  }

  async deactivateStaff(callerId: string, staffId: string): Promise<void> {
    if (callerId === staffId) {
      throw new ForbiddenException({
        error: {
          code: 'STAFF_SELF_DEACTIVATE_FORBIDDEN',
          message: 'Cannot deactivate your own account',
        },
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: staffId } });
    if (!user || user.role === 'CUSTOMER' || user.role === 'SUPER_ADMIN') {
      throw new StaffNotFoundException();
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: staffId },
        data: { isActive: false },
      }),
      // Drop every Better Auth session so a deactivated operator is signed
      // out at once. SessionAuthGuard also rejects them via the isActive
      // check, but the dead session rows should not linger (spec §4 Scenario G).
      this.prisma.session.deleteMany({ where: { userId: staffId } }),
    ]);
  }

  // ── Admin: Roles ─────────────────────────────────────────────────────────

  async listRoles() {
    return this.prisma.role.findMany({
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createRole(dto: CreateRoleDto) {
    const existing = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException({
        error: { code: 'ROLE_NAME_TAKEN', message: 'Role name already exists' },
      });
    }

    return this.prisma.role.create({
      data: {
        name: dto.name,
        description: dto.description,
        permissions: {
          create: dto.permissions.map((p) => ({ permission: p })),
        },
      },
      include: {
        permissions: { select: { permission: true } },
      },
    });
  }

  async updateRolePermissions(roleId: string, dto: UpdateRolePermissionsDto) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new RoleNotFoundException();
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });

      return tx.role.update({
        where: { id: roleId },
        data: {
          permissions: {
            create: dto.permissions.map((p) => ({ permission: p })),
          },
        },
        include: {
          permissions: { select: { permission: true } },
        },
      });
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async assertAddressOwnership(userId: string, addressId: string): Promise<void> {
    const address = await this.prisma.address.findUnique({
      where: { id: addressId },
      select: { userId: true },
    });

    if (!address) {
      throw new NotFoundException({
        error: { code: 'ADDRESS_NOT_FOUND', message: 'Address not found' },
      });
    }

    if (address.userId !== userId) {
      throw new ForbiddenException({
        error: { code: 'ADDRESS_ACCESS_DENIED', message: 'Access denied' },
      });
    }
  }

  private sanitizeUser<T extends { passwordHash?: string | null }>(
    user: T,
  ): Omit<T, 'passwordHash'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safe } = user;
    return safe;
  }

  /**
   * The extra strip for `/v1/users/me` (plan J, sweep S4).
   *
   * `getProfile` and `updateProfile` read the row with relation includes and no
   * scalar select, so the response carried the Resend webhook ops state
   * (`emailDeliverability`, `emailBouncedAt`, `emailComplainedAt`) and the
   * soft-delete column. It is the caller's own row, so the severity is low, but
   * these are operational plumbing per §3.5, not profile fields.
   *
   * Applied at the two `/v1/users/me` call sites rather than inside
   * `sanitizeUser`: that helper is shared with the admin customer and staff
   * endpoints, which are an admin surface and out of scope here.
   */
  private stripProfileInternals<T extends Record<string, unknown>>(
    user: T,
  ): Omit<T, (typeof PROFILE_INTERNAL_FIELDS)[number]> {
    const profile = { ...user };
    for (const field of PROFILE_INTERNAL_FIELDS) delete profile[field];
    return profile as Omit<T, (typeof PROFILE_INTERNAL_FIELDS)[number]>;
  }
}
