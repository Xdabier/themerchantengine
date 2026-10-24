/**
 * Creates a SUPER_ADMIN user against the configured database.
 *
 * Interactive, inside the api container:
 *   docker compose run --rm api npx ts-node apps/api/scripts/create-admin.ts
 *
 * Non-interactive, as the install stepper runs it (plan E4.4):
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_FIRST_NAME=... ADMIN_LAST_NAME=... \
 *     npx ts-node apps/api/scripts/create-admin.ts --from-env
 *
 * Reads DATABASE_URL from the environment. Hashes the password with bcrypt
 * at cost 12 and inserts a user linked to the seeded "Super Admin" role plus
 * the Better Auth credential account the email sign-in reads.
 *
 * Idempotent on email: an existing user is reported and left as it is, and
 * the exit code is 0 in `--from-env` mode so a re-run of the stepper on the
 * same box passes this step. Interactive mode keeps the previous refusal.
 */
import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import * as bcrypt from 'bcrypt';
// eslint-disable-next-line @nx/enforce-module-boundaries -- ts-node in the runtime image ignores tsconfig paths
import { NEUTRAL_LOCALE_SET } from '../../../libs/shared/common/src/locale/store-locales';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export const PASSWORD_MIN_LENGTH = 12;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface MutableWritable extends Writable {
  muted: boolean;
}

export interface AdminInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  /** The store's default locale from the stepper; the neutral default when nothing says otherwise. */
  locale: string;
}

/** The same rule for both modes; a message on refusal, null when acceptable. */
export function validateAdminInput(input: AdminInput): string | null {
  if (!EMAIL.test(input.email)) return 'Invalid email.';
  if (input.password.length < PASSWORD_MIN_LENGTH) {
    return `Password too short. Need at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!input.firstName.trim() || !input.lastName.trim()) return 'First and last name are required.';
  return null;
}

/** Reads the four variables the stepper sets; names the first missing one. */
export function adminInputFromEnv(env: NodeJS.ProcessEnv): AdminInput {
  const read = (key: string): string => {
    const value = env[key];
    if (!value) throw new Error(`${key} is not set; --from-env needs it.`);
    return value;
  };
  return {
    email: read('ADMIN_EMAIL').toLowerCase(),
    password: read('ADMIN_PASSWORD'),
    firstName: read('ADMIN_FIRST_NAME'),
    lastName: read('ADMIN_LAST_NAME'),
    locale: env['ADMIN_LOCALE'] || NEUTRAL_LOCALE_SET.defaultLocale,
  };
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function promptHidden(
  rl: readline.Interface,
  out: MutableWritable,
  question: string,
): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    out.muted = true;
    rl.question('', (answer) => {
      out.muted = false;
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function adminInputInteractive(): Promise<AdminInput> {
  const mutableOut: MutableWritable = Object.assign(
    new Writable({
      write(chunk, _enc, cb) {
        if (!mutableOut.muted) process.stdout.write(chunk);
        cb();
      },
    }),
    { muted: false },
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableOut,
    terminal: true,
  });
  try {
    console.log('── Create admin user ────────────────────────────────────');
    const email = (await prompt(rl, 'Email: ')).toLowerCase();
    const firstName = (await prompt(rl, 'First name: ')) || 'Admin';
    const lastName = (await prompt(rl, 'Last name: ')) || 'User';
    const password = await promptHidden(
      rl,
      mutableOut,
      `Password (≥${PASSWORD_MIN_LENGTH} chars): `,
    );
    const confirm = await promptHidden(rl, mutableOut, 'Confirm password: ');
    if (password !== confirm) {
      console.error('Passwords do not match.');
      process.exit(6);
    }
    return { email, firstName, lastName, password, locale: NEUTRAL_LOCALE_SET.defaultLocale };
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const fromEnv = process.argv.includes('--from-env');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set. Run inside the api container.');
    process.exit(1);
  }

  const input = fromEnv ? adminInputFromEnv(process.env) : await adminInputInteractive();
  const refusal = validateAdminInput(input);
  if (refusal) {
    console.error(refusal);
    process.exit(3);
  }

  const adapter = new PrismaPg(databaseUrl);
  const prisma = new PrismaClient({ adapter });
  try {
    const role = await prisma.role.findUnique({ where: { name: 'Super Admin' } });
    if (!role) {
      console.error('Role "Super Admin" not found. Run prisma db seed first.');
      process.exit(2);
    }

    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      if (fromEnv) {
        console.log(`Admin ${input.email} already exists (id=${existing.id}); nothing to do.`);
        return;
      }
      console.error(`User ${input.email} already exists (id=${existing.id}). Aborting.`);
      process.exit(4);
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          name: `${input.firstName} ${input.lastName}`,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          role: 'SUPER_ADMIN',
          roleId: role.id,
          emailVerified: true,
          isActive: true,
          locale: input.locale,
        },
        select: { id: true, email: true },
      });
      // Better Auth `credential` Account, the row email/password sign-in
      // reads. Without it the super-admin could not sign in.
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
    console.log(`✓ Created super-admin ${user.email} (id=${user.id})`);
  } catch (err) {
    console.error('Failed:', (err as Error).message);
    process.exit(10);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
