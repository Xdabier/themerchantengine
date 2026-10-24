import type { PrismaClient, User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/**
 * Reviewer pool — 8 catalogue-scoped users used to author reviews and Q&A.
 * Idempotence keyed by email. The shared password is constant across re-seeds
 * (test env only — never reproduced in prod).
 */
const REVIEWERS = [
  {
    email: 'fx-reviewer-aisha@fixture.test',
    firstName: 'Aisha',
    lastName: 'Al Mansoori',
    locale: 'fr',
  },
  {
    email: 'fx-reviewer-omar@fixture.test',
    firstName: 'Omar',
    lastName: 'Al Thani',
    locale: 'fr',
  },
  {
    email: 'fx-reviewer-noura@fixture.test',
    firstName: 'Noura',
    lastName: 'Al Sayegh',
    locale: 'fr',
  },
  {
    email: 'fx-reviewer-saif@fixture.test',
    firstName: 'Saif',
    lastName: 'Al Kuwari',
    locale: 'fr',
  },
  {
    email: 'fx-reviewer-leila@fixture.test',
    firstName: 'Leila',
    lastName: 'Hassan',
    locale: 'en',
  },
  {
    email: 'fx-reviewer-ahmed@fixture.test',
    firstName: 'Ahmed',
    lastName: 'Al Suwaidi',
    locale: 'fr',
  },
  {
    email: 'fx-reviewer-maryam@fixture.test',
    firstName: 'Maryam',
    lastName: 'Al Ansari',
    locale: 'fr',
  },
  {
    email: 'fx-reviewer-yousef@fixture.test',
    firstName: 'Yousef',
    lastName: 'Khalil',
    locale: 'en',
  },
];

const REVIEWER_PASSWORD = 'Fixture-Test-123!';

export async function seedReviewers(prisma: PrismaClient): Promise<User[]> {
  const passwordHash = await bcrypt.hash(REVIEWER_PASSWORD, 12);
  const out: User[] = [];

  for (const r of REVIEWERS) {
    const user = await prisma.user.upsert({
      where: { email: r.email },
      update: { firstName: r.firstName, lastName: r.lastName, locale: r.locale },
      create: {
        email: r.email,
        name: `${r.firstName} ${r.lastName}`,
        firstName: r.firstName,
        lastName: r.lastName,
        passwordHash,
        role: UserRole.CUSTOMER,
        emailVerified: true,
        isActive: true,
        locale: r.locale,
      },
    });
    // Better Auth credential Account — its email/password sign-in reads
    // Account.password, not the legacy User.passwordHash column.
    await prisma.account.upsert({
      where: { id: `cred_${user.id}` },
      update: { password: passwordHash },
      create: {
        id: `cred_${user.id}`,
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: passwordHash,
      },
    });

    out.push(user);
  }

  return out;
}
