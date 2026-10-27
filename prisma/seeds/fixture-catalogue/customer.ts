import type { PrismaClient } from '@prisma/client';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { SeededProduct } from './products';
import type { StoreRuntimeConfig } from '../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { seedAddress } from './lib/seed-address';

/**
 * One dev customer used by COD checkout flows. Carries one address
 * (default shipping + billing) and one wishlist item linked to a featured
 * fixture catalogue product. The DELIVERED order on `fx-laptop-pro-16-studio`
 * is seeded by `orders.ts` after this step so the verified-purchase
 * gate at `apps/api/src/modules/reviews/reviews.service.ts:117-127` is
 * satisfied locally — the storefront review/Q&A journey specs at
 * `apps/storefront-e2e/src/reviews.journey.spec.ts:166, :267, :318` all
 * authenticate as this customer and depend on the fixture.
 */
const CUSTOMER_EMAIL = 'cod-test+fixture@fixture.test';
const CUSTOMER_PASSWORD = 'Fixture-Test-123!';

export async function seedCustomer(args: {
  /** The store's identity, so the seeded address is in a market it ships to. */
  identity: StoreRuntimeConfig['identity'];
  prisma: PrismaClient;
  products: SeededProduct[];
}): Promise<{ customerId: string }> {
  const passwordHash = await bcrypt.hash(CUSTOMER_PASSWORD, 12);

  const customer = await args.prisma.user.upsert({
    where: { email: CUSTOMER_EMAIL },
    update: { firstName: 'Aisha', lastName: 'Rivera', isActive: true, emailVerified: true },
    create: {
      email: CUSTOMER_EMAIL,
      name: 'Aisha Rivera',
      firstName: 'Aisha',
      lastName: 'Rivera',
      passwordHash,
      role: UserRole.CUSTOMER,
      emailVerified: true,
      isActive: true,
      locale: 'fr',
      phone: args.identity.contact.phone,
    },
  });

  // Better Auth credential Account — its email/password sign-in reads
  // Account.password, not the legacy User.passwordHash column.
  await args.prisma.account.upsert({
    where: { id: `cred_${customer.id}` },
    update: { password: passwordHash },
    create: {
      id: `cred_${customer.id}`,
      userId: customer.id,
      accountId: customer.id,
      providerId: 'credential',
      password: passwordHash,
    },
  });

  const existingAddress = await args.prisma.address.findFirst({
    where: { userId: customer.id },
  });
  if (!existingAddress) {
    await args.prisma.address.create({
      data: {
        userId: customer.id,
        label: 'Home',
        ...seedAddress(args.identity, 'Aisha Rivera'),
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    });
  }

  const featured = args.products.find((p) => p.row.isFeatured) ?? args.products[0];
  if (featured) {
    await args.prisma.wishlistItem.upsert({
      where: { userId_productId: { userId: customer.id, productId: featured.id } },
      update: {},
      create: { userId: customer.id, productId: featured.id },
    });
  }

  return { customerId: customer.id };
}
