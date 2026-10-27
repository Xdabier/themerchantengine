import * as path from 'node:path';
import type { SetupAnswers } from '../answers';
import { ui, type Output } from '../cli/ui';
import {
  buildStoreConfig,
  serializeStoreConfig,
  CLIENT_CONFIG_FILE,
} from '../output/client-config';
import {
  GSC_CONTAINER_PATH,
  LOGO_CONTAINER_PATH,
  composeEngineEnv,
  composeStorefrontEnv,
} from '../output/compose-env';
import { parseEnv, serializeEnv } from '../output/env-file';
import type { Ports } from '../ports';
import { renderFile } from '../render/template';
import { generateSecrets, type GeneratedSecrets } from '../state/secrets';
import { hostOf } from '../../../../libs/shared/common/src/url';
import { NEUTRAL_LOCALE_SET } from '../../../../libs/shared/common/src/locale/store-locales';
import { BACKUP_DIR, IMAGE_TAG, layoutFor, relative, type Layout } from './layout';
import type { Shell } from './shell';

/**
 * The install runners (plan E4.4, E4.5 and E4.6). One ordered list of
 * idempotent steps per profile, each a function over the shell port, so a
 * spec can run the whole install against a recording shell and assert every
 * command, and run it twice to prove the second pass changes nothing.
 */
export interface InstallStep {
  id: string;
  title: string;
  run(): Promise<void>;
}

export interface InstallContext {
  answers: SetupAnswers;
  secrets: GeneratedSecrets;
  layout: Layout;
  shell: Shell;
  ports: Ports;
  out: Output;
  now: () => Date;
}

export class InstallFailed extends Error {
  constructor(
    readonly stepId: string,
    message: string,
  ) {
    super(message);
  }
}

const HEADER = (profile: string, when: Date) =>
  `Written by themerchantengine setup (profile ${profile}) on ${when.toISOString()}.\nRun setup again to change a value; do not edit by hand.`;

/**
 * Secrets an earlier run wrote are kept; a fresh run generates them. The
 * engine env file is the source when this box runs the engine; a
 * storefront-only box keeps its own sidecar Redis password and the
 * revalidate secret it was handed.
 */
export function secretsFor(shell: Shell, layout: Layout): GeneratedSecrets {
  const engine =
    layout.engineEnvFile && shell.exists(layout.engineEnvFile)
      ? parseEnv(shell.readFile(layout.engineEnvFile))
      : {};
  const storefront =
    layout.storefrontEnvFile && shell.exists(layout.storefrontEnvFile)
      ? parseEnv(shell.readFile(layout.storefrontEnvFile))
      : {};
  return generateSecrets(
    layout.runsEngine
      ? engine
      : {
          STOREFRONT_REDIS_PASSWORD: storefront['REDIS_PASSWORD'] ?? '',
          STOREFRONT_REVALIDATE_SECRET: storefront['STOREFRONT_REVALIDATE_SECRET'] ?? '',
        },
  );
}

function compose(ctx: InstallContext): string[] {
  return ['compose', '-f', ctx.layout.composeFile, '--env-file', ctx.layout.composeEnvFile];
}

async function waitHealthy(ctx: InstallContext, container: string, attempts = 60): Promise<void> {
  // A dry run starts nothing, so there is nothing to wait for.
  if (ctx.shell.dryRun) return;
  for (let i = 0; i < attempts; i += 1) {
    const result = await ctx.shell.run(
      'docker',
      ['inspect', '--format', '{{.State.Health.Status}}', container],
      { capture: true, allowFailure: true },
    );
    if (result.code === 0 && result.stdout.trim() === 'healthy') return;
    await ctx.shell.sleep(2000);
  }
  throw new InstallFailed('database-up', `${container} did not become healthy`);
}

/**
 * One psql invocation over stdin as the postgres superuser. A variable is set
 * with \\set inside the stream rather than with -v on the command line, so a
 * password never appears in the process list; the values are the hex secrets
 * this stepper generates, and anything else is refused rather than quoted.
 */
async function psql(
  ctx: InstallContext,
  sql: string,
  database = 'postgres',
  vars: Record<string, string> = {},
): Promise<string> {
  const args = [
    'exec',
    '-i',
    ctx.layout.containers.postgres,
    'psql',
    '-U',
    'postgres',
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-tA',
  ];
  const preamble = Object.entries(vars)
    .map(([key, value]) => {
      if (!/^[0-9a-f]+$/.test(value))
        throw new InstallFailed('database-up', `${key} is not a hex secret`);
      return `\\set ${key} '${value}'`;
    })
    .join('\n');
  const result = await ctx.shell.run('docker', args, {
    input: preamble ? `${preamble}\n${sql}` : sql,
    capture: true,
  });
  return result.stdout.trim();
}

/** A store with no user row yet: the demo seed may run. The owner is created after the seed, so a first install has none. */
async function isFreshStore(ctx: InstallContext): Promise<boolean> {
  // A dry run starts no database, so there is nothing to count.
  if (ctx.shell.dryRun) return true;
  const users = await psql(ctx, 'SELECT count(*) FROM "User";', 'merchants_engine');
  // Fail closed: an answer that is not a count is not proof of an empty store.
  if (!/^\d+$/.test(users)) {
    ui.warn(
      ctx.out,
      `demo catalogue skipped: the user count could not be read (${JSON.stringify(users)})`,
    );
    return false;
  }
  const count = Number(users);
  if (count > 0) {
    ui.note(
      ctx.out,
      `demo catalogue skipped: the store already holds ${count} user(s), and the demo seed is a first-install step`,
    );
    return false;
  }
  return true;
}

/** The steps every profile that runs the engine performs, in order. */
export function engineSteps(ctx: InstallContext): InstallStep[] {
  const { answers, layout, shell, out } = ctx;
  const root = layout.root;
  const steps: InstallStep[] = [];

  steps.push({
    id: 'write-outputs',
    title: 'Write the environment, the store config and the rendered stack',
    async run() {
      const when = ctx.now();
      const engineEnv = composeEngineEnv(answers, ctx.secrets);
      shell.writeFile(
        layout.engineEnvFile as string,
        serializeEnv(engineEnv, HEADER(layout.profile, when)),
        0o600,
      );
      if (layout.runsStorefront) {
        shell.writeFile(
          layout.storefrontEnvFile as string,
          serializeEnv(composeStorefrontEnv(answers, ctx.secrets), HEADER(layout.profile, when)),
          0o600,
        );
      }
      const config = buildStoreConfig(answers);
      shell.writeFile(path.join(root, CLIENT_CONFIG_FILE), serializeStoreConfig(config));
      shell.mkdir(layout.configDir);
      shell.copyFile(
        path.join(root, CLIENT_CONFIG_FILE),
        path.join(layout.configDir, CLIENT_CONFIG_FILE),
      );
      if (answers.seo?.gscServiceAccountFile) {
        shell.copyFile(
          path.resolve(root, answers.seo.gscServiceAccountFile),
          path.join(layout.configDir, path.basename(GSC_CONTAINER_PATH)),
        );
      }
      if (answers.brand?.logoPath) {
        shell.copyFile(
          path.resolve(root, answers.brand.logoPath),
          path.join(layout.configDir, path.basename(LOGO_CONTAINER_PATH)),
        );
      }
      writeStack(ctx);
      ui.ok(
        out,
        `${relative(root, layout.composeFile)} and ${relative(root, layout.engineEnvFile as string)} written`,
      );
    },
  });

  if (answers.brand?.logoPath) {
    steps.push({
      id: 'upload-logo',
      title: 'Publish the logo to asset storage',
      async run() {
        const source = path.resolve(root, answers.brand?.logoPath as string);
        const key = logoKey(answers.brand?.logoPath as string);
        const storage = answers.storage;
        if (storage?.driver === 's3') {
          await ctx.ports.s3Put(
            {
              endpoint: storage.endpoint as string,
              region: storage.region as string,
              bucket: storage.bucket as string,
              accessKey: storage.accessKey as string,
              secretKey: storage.secretKey as string,
              forcePathStyle: (storage.bucket as string).includes('.'),
            },
            key,
            shell.readBinary(source),
            contentTypeOf(source),
          );
        } else {
          // The local driver serves ./uploads, mounted from the profile directory.
          shell.copyFile(source, path.join(layout.dir, 'uploads', key));
        }
        ui.ok(out, `logo published at ${logoPublicUrl(ctx)}`);
      },
    });
  }

  steps.push({
    id: 'build-images',
    title: 'Build the images from source',
    async run() {
      await shell.run('docker', [...compose(ctx), 'build'], { cwd: root });
    },
  });

  steps.push({
    id: 'database-up',
    title: 'Start Postgres and Redis, create the app role and database',
    async run() {
      await shell.run('docker', [...compose(ctx), 'up', '-d', 'postgres', 'redis'], { cwd: root });
      await waitHealthy(ctx, layout.containers.postgres);
      const roleExists = await psql(ctx, "SELECT 1 FROM pg_roles WHERE rolname='merchants_app';");
      if (roleExists !== '1') {
        // `:'db_pwd'` interpolation is psql's own quoting, safe for any password.
        await psql(ctx, "CREATE USER merchants_app WITH PASSWORD :'db_pwd';", 'postgres', {
          db_pwd: ctx.secrets.DB_PASSWORD,
        });
      } else {
        await psql(ctx, "ALTER USER merchants_app WITH PASSWORD :'db_pwd';", 'postgres', {
          db_pwd: ctx.secrets.DB_PASSWORD,
        });
      }
      const dbExists = await psql(
        ctx,
        "SELECT 1 FROM pg_database WHERE datname='merchants_engine';",
      );
      if (dbExists !== '1') {
        await psql(ctx, 'CREATE DATABASE merchants_engine OWNER merchants_app;');
      }
      // Postgres 15+ keeps the public schema owned by postgres; without this
      // the first CREATE TYPE of `prisma db push` is refused.
      await psql(
        ctx,
        'ALTER SCHEMA public OWNER TO merchants_app; GRANT ALL ON SCHEMA public TO merchants_app;',
        'merchants_engine',
      );
    },
  });

  steps.push({
    id: 'schema',
    title: 'Push the schema, the search index and the extra indexes',
    async run() {
      await shell.run(
        'docker',
        [
          ...compose(ctx),
          'run',
          '--rm',
          'api',
          'npx',
          'prisma',
          'db',
          'push',
          '--accept-data-loss',
        ],
        { cwd: root },
      );
      // `db push` drops the search vector and its trigger; re-applied as the
      // superuser through the postgres container, which owns the function.
      const fts = shell.readFile(path.join(root, 'prisma', 'search_fts_setup.sql'));
      await shell.run(
        'docker',
        [
          'exec',
          '-i',
          layout.containers.postgres,
          'psql',
          '-U',
          'postgres',
          '-d',
          'merchants_engine',
          '-v',
          'ON_ERROR_STOP=1',
          '-f',
          '-',
        ],
        { input: fts },
      );
      for (const script of [
        'prisma/apply-notification-indexes.ts',
        'prisma/apply-shipping-indexes.ts',
      ]) {
        await shell.run(
          'docker',
          [...compose(ctx), 'run', '--rm', 'api', 'npx', 'ts-node', '--transpile-only', script],
          { cwd: root },
        );
      }
    },
  });

  steps.push({
    id: 'seed',
    title: 'Seed the store config, roles, templates, tax, shipping and payment methods',
    async run() {
      const env: string[] = [
        '-e',
        'SEED_SCOPE=notifications-rbac',
        '-e',
        `STORE_CONFIG_FILE=/app/config/${CLIENT_CONFIG_FILE}`,
        '-e',
        `SEED_SHIPPING_FLAT_RATE=${answers.money?.shippingFlatRate ?? ''}`,
      ];
      const logoUrl = logoPublicUrl(ctx);
      if (logoUrl) env.push('-e', `STORE_LOGO_URL=${logoUrl}`);
      await shell.run(
        'docker',
        [...compose(ctx), 'run', '--rm', ...env, 'api', 'npx', 'prisma', 'db', 'seed'],
        { cwd: root },
      );
      if (answers.demoCatalogue && (await isFreshStore(ctx))) {
        // First install only. The demo seed is the destructive path: it
        // hard-deletes every order, review, address and gift card it did not
        // plant, so a re-run on a store with history must never reach it. A
        // store with any user row is not fresh (the owner is created below,
        // after this step, so a first install has none yet), and the seed's
        // own tripwire needs SEED_DEV_OK=1 for any database but the test one.
        await shell.run(
          'docker',
          [
            ...compose(ctx),
            'run',
            '--rm',
            '-e',
            'SEED_DEV_OK=1',
            '-e',
            'FIXTURE_CATALOGUE_SEED=1',
            '-e',
            `STORE_CONFIG_FILE=/app/config/${CLIENT_CONFIG_FILE}`,
            '-v',
            `${path.join(root, 'apps', 'api', 'src')}:/app/apps/api/src:ro`,
            '-v',
            `${path.join(root, 'libs')}:/app/libs:ro`,
            '-v',
            `${path.join(root, 'test')}:/app/test:ro`,
            'api',
            'npx',
            'prisma',
            'db',
            'seed',
          ],
          { cwd: root },
        );
        if (!layout.local) {
          // The demo seed plants sample accounts with passwords that are in
          // this repository; a server keeps the catalogue and loses the
          // logins. The credential row is what signs in, so it goes first;
          // the rename, the hash and the soft delete close the rest.
          await psql(ctx, scrambleSeededAccountsSql(), 'merchants_engine');
        }
      }
    },
  });

  steps.push({
    id: 'owner',
    title: 'Create the admin owner account',
    async run() {
      const owner = answers.owner;
      if (!owner?.email || !owner.password)
        throw new InstallFailed('owner', 'the owner account was never answered');
      await shell.run(
        'docker',
        [
          ...compose(ctx),
          'run',
          '--rm',
          '-e',
          `ADMIN_EMAIL=${owner.email}`,
          '-e',
          'ADMIN_PASSWORD',
          '-e',
          `ADMIN_FIRST_NAME=${owner.firstName ?? 'Store'}`,
          '-e',
          `ADMIN_LAST_NAME=${owner.lastName ?? 'Owner'}`,
          '-e',
          `ADMIN_LOCALE=${answers.localization?.defaultLocale ?? NEUTRAL_LOCALE_SET.defaultLocale}`,
          'api',
          'npx',
          'ts-node',
          '--transpile-only',
          'apps/api/scripts/create-admin.ts',
          '--from-env',
        ],
        // The password reaches the container through the environment of this
        // process, never through a command line another user can list.
        { cwd: root, env: { ADMIN_PASSWORD: owner.password } },
      );
    },
  });

  // The edge and the public stack come up last: until here nothing answers
  // on a public port, so the seeded accounts the scramble above retires and
  // the owner account never exist on a reachable store.
  if (!layout.local) steps.push(tlsStep(ctx));
  steps.push({
    id: 'stack-up',
    title: 'Start the whole stack',
    async run() {
      await shell.run('docker', [...compose(ctx), 'up', '-d'], { cwd: root });
    },
  });

  if (!layout.local) steps.push(timersStep(ctx));

  return steps;
}

/** The storefront-only box (plan E4.5). */
export function storefrontSteps(ctx: InstallContext): InstallStep[] {
  const { layout, shell, out, answers } = ctx;
  const root = layout.root;
  return [
    {
      id: 'write-outputs',
      title: 'Write the environment and the rendered stack',
      async run() {
        shell.writeFile(
          layout.storefrontEnvFile as string,
          serializeEnv(
            composeStorefrontEnv(answers, ctx.secrets),
            HEADER(layout.profile, ctx.now()),
          ),
          0o600,
        );
        writeStack(ctx);
        ui.ok(
          out,
          `${relative(root, layout.composeFile)} and ${relative(root, layout.storefrontEnvFile as string)} written`,
        );
      },
    },
    {
      id: 'build-images',
      title: 'Build the storefront image from source',
      async run() {
        await shell.run('docker', [...compose(ctx), 'build'], { cwd: root });
      },
    },
    tlsStep(ctx),
    {
      id: 'stack-up',
      title: 'Start the storefront stack',
      async run() {
        await shell.run('docker', [...compose(ctx), 'up', '-d'], { cwd: root });
      },
    },
    timersStep(ctx),
  ];
}

/** Renders the compose file, the http vhost (or the local edge) and the IndexNow key file. */
function writeStack(ctx: InstallContext): void {
  const { answers, layout, shell } = ctx;
  const root = layout.root;
  const envRelative = (file: string) => relative(layout.dir, file);
  const templateFor: Record<string, string> = {
    engine: 'compose.engine.yml',
    storefront: 'compose.storefront.yml',
    both: 'compose.both.yml',
    local: 'compose.local.yml',
  };
  const vars: Record<string, string> = {
    PROJECT_NAME: layout.projectName,
    IMAGE_TAG,
    ENV_FILE: envRelative(layout.composeEnvFile),
  };
  if (layout.runsEngine) {
    vars['API_HOST'] = hostOnly(layout.urls.api);
    vars['ADMIN_HOST'] = hostOnly(layout.urls.admin);
  }
  if (layout.runsStorefront) {
    vars['STOREFRONT_HOST'] = hostOnly(layout.urls.storefront);
    vars['TURNSTILE_SITE_KEY'] = answers.turnstile?.enabled
      ? (answers.turnstile.siteKey ?? '')
      : '';
    if (layout.runsEngine)
      vars['STOREFRONT_ENV_FILE'] = envRelative(layout.storefrontEnvFile as string);
  }
  if (layout.profile === 'storefront') {
    delete vars['ENV_FILE'];
    vars['ENV_FILE'] = envRelative(layout.storefrontEnvFile as string);
  }
  if (layout.local) {
    delete vars['API_HOST'];
    delete vars['ADMIN_HOST'];
    delete vars['STOREFRONT_HOST'];
    // The uploads bind mounts belong to the host user; a root uid or gid keeps the image user.
    const hostUser = shell.hostUser;
    const rootish = !hostUser || hostUser.split(':').includes('0');
    vars['API_USER'] = rootish ? 'app' : hostUser;
  }
  shell.writeFile(layout.composeFile, renderFile(root, templateFor[layout.profile], vars));

  shell.mkdir(layout.nginxDir);
  if (layout.local) {
    shell.writeFile(
      path.join(layout.nginxDir, '10-admin.conf'),
      renderFile(root, 'nginx/local-admin.conf', {}),
    );
    shell.writeFile(
      path.join(layout.nginxDir, '10-storefront.conf'),
      renderFile(root, 'nginx/local-storefront.conf', {}),
    );
  } else {
    const hosts = layout.tlsHosts.flatMap((h) =>
      h.template === 'storefront' ? [h.host, `www.${h.host}`] : [h.host],
    );
    shell.writeFile(
      path.join(layout.nginxDir, '00-http.conf'),
      renderFile(root, 'nginx/http.conf', { HOSTS: hosts.join(' ') }),
    );
  }
  if (layout.runsStorefront) {
    shell.mkdir(layout.indexNowDir);
    const key = answers.seo?.indexNowKey;
    if (key) shell.writeFile(path.join(layout.indexNowDir, `${key}.txt`), `${key}\n`);
  }
  if (layout.local) {
    shell.mkdir(path.join(layout.dir, 'uploads'));
    shell.mkdir(path.join(layout.dir, 'uploads-private'));
  }
}

/** The edge on port 80 first, certbot's webroot challenge per host, then the TLS vhosts and a reload. */
function tlsStep(ctx: InstallContext): InstallStep {
  const { answers, layout, shell, out } = ctx;
  const root = layout.root;
  return {
    id: 'tls',
    title: "Issue the Let's Encrypt certificates and enable the TLS vhosts",
    async run() {
      await shell.run('docker', [...compose(ctx), 'up', '-d', 'nginx'], { cwd: root });
      const issued = await shell.run(
        'docker',
        [...compose(ctx), '--profile', 'tools', 'run', '--rm', '-T', 'certbot', 'certificates'],
        { cwd: root, capture: true, allowFailure: true },
      );
      const email = answers.domains?.certbotEmail ?? answers.identity?.contactEmail ?? '';
      for (const { host, template } of layout.tlsHosts) {
        if (issued.stdout.includes(`Certificate Name: ${host}`)) {
          ui.ok(out, `${host}: certificate already issued`);
        } else {
          const names =
            template === 'storefront' ? ['-d', host, '-d', `www.${host}`] : ['-d', host];
          await shell.run(
            'docker',
            [
              ...compose(ctx),
              '--profile',
              'tools',
              'run',
              '--rm',
              'certbot',
              'certonly',
              '--webroot',
              '-w',
              '/var/www/certbot',
              '-n',
              '--agree-tos',
              '--no-eff-email',
              '--email',
              email,
              ...names,
            ],
            { cwd: root },
          );
        }
        // The storefront vhost proxies the browser's /v1 calls to the API:
        // the container on a one-box install, the engine's public origin
        // from a storefront-only box. The Host header names the public API
        // host either way, which is what the API's own origin checks expect.
        const vars: Record<string, string> =
          template === 'storefront'
            ? {
                HOST: host,
                API_UPSTREAM: layout.runsEngine ? 'http://api:53000' : layout.urls.api,
                API_HOST: hostOf(layout.urls.api) ?? '',
              }
            : { HOST: host };
        shell.writeFile(
          path.join(layout.nginxDir, `10-${template}.conf`),
          renderFile(root, `nginx/${template}.conf`, vars),
        );
      }
      await shell.run('docker', [...compose(ctx), 'exec', 'nginx', 'nginx', '-s', 'reload'], {
        cwd: root,
      });
    },
  };
}

/** The renewal timer and, when the engine runs here, the nightly dump. Linux only. */
function timersStep(ctx: InstallContext): InstallStep {
  const { layout, shell, out } = ctx;
  const root = layout.root;
  return {
    id: 'timers',
    title: 'Install the certificate renewal and backup timers',
    async run() {
      if (shell.platform === 'win32' || shell.platform === 'darwin') {
        ui.warn(
          out,
          'systemd timers are Linux-only; renewal and backups are not scheduled on this platform',
        );
        return;
      }
      // `sudo env ENV_FILE=... bash script`: sudo's env_reset drops a variable
      // handed to it any other way, and the value is a path, not a secret.
      await shell.run(
        'env',
        [
          `ENV_FILE=${layout.composeEnvFile}`,
          'bash',
          path.join(root, 'deploy', 'shared', 'install-cert-renew-timer.sh'),
        ],
        { cwd: root, sudo: true },
      );
      if (!layout.runsEngine) return;
      shell.mkdir(layout.systemdDir);
      for (const unit of ['pg-backup.service', 'pg-backup.timer']) {
        const file = path.join(layout.systemdDir, `${layout.projectName}-${unit}`);
        shell.writeFile(
          file,
          renderFile(
            root,
            `systemd/${unit}`,
            unit.endsWith('.service')
              ? { PROJECT_NAME: layout.projectName, BACKUP_DIR }
              : { PROJECT_NAME: layout.projectName },
          ),
        );
        await shell.run(
          'install',
          ['-m', '0644', file, `/etc/systemd/system/${layout.projectName}-${unit}`],
          { sudo: true },
        );
      }
      await shell.run('systemctl', ['daemon-reload'], { sudo: true });
      await shell.run('systemctl', ['enable', '--now', `${layout.projectName}-pg-backup.timer`], {
        sudo: true,
      });
    },
  };
}

/** The probes both runners end on; a failing one fails the install rather than reporting success. */
export function smokeStep(ctx: InstallContext): InstallStep {
  const { layout, shell, out } = ctx;
  return {
    id: 'smoke',
    title: 'Smoke: health, the public config and the front doors',
    async run() {
      const probes: {
        url: string;
        expect: (status: number, body: string, headers: Record<string, string>) => boolean;
        what: string;
      }[] = [];
      if (layout.runsEngine) {
        probes.push({
          url: `${layout.urls.api}/health`,
          expect: (s, b) => s === 200 && b.includes('"ok"'),
          what: 'the API health',
        });
        probes.push({
          url: `${layout.urls.api}/api/v1/store/config`,
          expect: (s, b) => s === 200 && b.includes('"identity"'),
          what: 'the public store config',
        });
        probes.push({
          url: `${layout.urls.admin}/`,
          // The headers, not only the status: the admin container once served
          // none of them because a location-level add_header suppressed the
          // server-level set, and nothing probed for them.
          expect: (s, _b, h) =>
            s === 200 &&
            (h['x-frame-options'] ?? '').toUpperCase() === 'DENY' &&
            (h['content-security-policy'] ?? '').includes("frame-ancestors 'none'") &&
            (h['x-content-type-options'] ?? '').toLowerCase() === 'nosniff' &&
            (h['referrer-policy'] ?? '') !== '' &&
            (h['permissions-policy'] ?? '') !== '',
          what: 'the admin login page with its security headers',
        });
      }
      if (layout.runsStorefront) {
        probes.push({
          url: `${layout.urls.storefront}/`,
          expect: (s) => s === 200 || (s >= 300 && s < 400),
          what: 'the storefront',
        });
      }
      if (shell.dryRun) {
        // Nothing is running; the probes are listed so the operator sees what a
        // real run would hold the install to.
        for (const probe of probes) ui.note(out, `would probe ${probe.what}: ${probe.url}`);
        return;
      }
      for (const probe of probes) {
        let last: { status: number; body: string; headers: Record<string, string> } = {
          status: 0,
          body: '',
          headers: {},
        };
        for (let attempt = 0; attempt < 30; attempt += 1) {
          last = await shell.probe(probe.url);
          if (probe.expect(last.status, last.body, last.headers)) break;
          await shell.sleep(2000);
        }
        if (!probe.expect(last.status, last.body, last.headers)) {
          throw new InstallFailed(
            'smoke',
            `${probe.what} at ${probe.url} answered ${last.status || 'nothing'}`,
          );
        }
        ui.ok(out, `${probe.what}: ${probe.url}`);
      }
    },
  };
}

export function installSteps(ctx: InstallContext): InstallStep[] {
  const steps = ctx.layout.runsEngine ? engineSteps(ctx) : storefrontSteps(ctx);
  return [...steps, smokeStep(ctx)];
}

/** The closing lines the plan names, plus what the other box needs. */
export function closingLines(ctx: InstallContext): string[] {
  const { layout, answers } = ctx;
  const lines: string[] = [];
  if (layout.runsEngine) {
    lines.push('backend server installed successfully!');
    lines.push(`admin: ${layout.urls.admin}/`);
    lines.push(`owner login: ${answers.owner?.email ?? ''}`);
    if (layout.profile === 'engine') {
      lines.push(
        `storefront box: run setup with --profile storefront; when it asks for the revalidate secret, read it with: grep STOREFRONT_REVALIDATE_SECRET ${relative(layout.root, layout.engineEnvFile as string)}`,
      );
    }
  }
  if (layout.runsStorefront) {
    lines.push('storefront server installed successfully!');
    lines.push(`storefront: ${layout.urls.storefront}/`);
  }
  return lines;
}

export async function runInstall(
  ctx: InstallContext,
  steps: InstallStep[] = installSteps(ctx),
): Promise<void> {
  for (let i = 0; i < steps.length; i += 1) {
    ui.step(ctx.out, i + 1, steps.length, steps[i].title);
    await steps[i].run();
  }
  ctx.out.write('\n');
  for (const line of closingLines(ctx)) ctx.out.write(`${line}\n`);
}

export function installContext(
  answers: SetupAnswers,
  root: string,
  shell: Shell,
  ports: Ports,
  out: Output,
  now: () => Date = () => new Date(),
): InstallContext {
  const layout = layoutFor(answers, root);
  return { answers, secrets: secretsFor(shell, layout), layout, shell, ports, out, now };
}

function logoKey(logoPath: string): string {
  return `brand/logo${path.extname(logoPath).toLowerCase()}`;
}

function contentTypeOf(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return ext === '.svg'
    ? 'image/svg+xml'
    : ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';
}

/**
 * Every address family the seeds use for a throwaway account, as SQL LIKE
 * patterns. The spec derives the addresses from the seed sources and proves
 * each one matches a pattern here, so a seed that adds an account the runner
 * would leave live fails the suite rather than shipping.
 */
export const SEEDED_ACCOUNT_PATTERNS = [
  '%@merchants.test',
  '%@fixture.test',
  'customer%@test.com',
] as const;

export function scrambleSeededAccountsSql(): string {
  const where = SEEDED_ACCOUNT_PATTERNS.map((p) => `email LIKE '${p}'`).join(' OR ');
  return [
    `DELETE FROM "Account" WHERE "providerId" = 'credential' AND "userId" IN (SELECT id FROM "User" WHERE ${where});`,
    `UPDATE "User" SET email = email || '.disabled.' || gen_random_uuid()::text, "passwordHash" = encode(gen_random_bytes(60), 'hex'), "emailVerified" = false, "isActive" = false, "deletedAt" = NOW() WHERE ${where};`,
  ].join('\n');
}

function hostOnly(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
}

/** Where the uploaded logo is reachable, when a logo was given: the storage public URL or the local uploads route. */
function logoPublicUrl(ctx: InstallContext): string | null {
  const { answers, layout } = ctx;
  const logo = answers.brand?.logoPath;
  if (!logo) return null;
  const name = logoKey(logo);
  if (answers.storage?.driver === 's3' && answers.storage.publicUrl)
    return `${answers.storage.publicUrl}/${name}`;
  return `${layout.urls.api}/uploads/${name}`;
}
