import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SetupAnswers } from '../answers';
import type { Output } from '../cli/ui';
import { COMPLETE_ANSWERS } from '../output/client-config.spec';
import { CLIENT_CONFIG_FILE } from '../output/client-config';
import { parseEnv } from '../output/env-file';
import { fakePorts } from '../ports/fake';
import * as fs from 'node:fs';
import {
  SEEDED_ACCOUNT_PATTERNS,
  closingLines,
  installContext,
  installSteps,
  runInstall,
  scrambleSeededAccountsSql,
  InstallFailed,
} from './install';
import { layoutFor } from './layout';
import { commandLines, recordingShell, type RecordingShell } from './recording-shell';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function output(): Output & { text: string } {
  const out = {
    text: '',
    isTTY: false,
    write(chunk: string) {
      out.text += chunk;
    },
  };
  return out;
}

const SERVER: SetupAnswers = {
  ...COMPLETE_ANSWERS,
  profile: 'both',
  license: { file: 'license.json' },
  domains: { ...COMPLETE_ANSWERS.domains, certbotEmail: 'ops@atlas.example' },
  brand: { ...COMPLETE_ANSWERS.brand, logoPath: 'logo.png' },
  storage: {
    driver: 's3',
    endpoint: 'https://s3.gra.example',
    region: 'gra',
    bucket: 'atlas-assets',
    publicUrl: 'https://atlas-assets.s3.gra.example',
    accessKey: 'AK',
    secretKey: 'SK',
  },
  mail: {
    transport: 'resend',
    apiKey: 're_1',
    webhookSecret: 'whsec_1',
    fromEmail: 'noreply@atlas.example',
    fromName: 'Atlas',
    replyTo: 'hello@atlas.example',
    contactFormRecipient: 'hello@atlas.example',
  },
  turnstile: { enabled: true, siteKey: '0xSITE', secretKey: '0xSECRET' },
  seo: { indexNowKey: 'abcdef1234567890', bingApiKey: '', gscServiceAccountFile: '' }, // gitleaks:allow
  payments: { cod: true, manual: false, stripe: false },
  owner: {
    email: 'owner@atlas.example',
    firstName: 'Ada',
    lastName: 'Atlas',
    password: 'CorrectHorse9x',
  },
  demoCatalogue: false,
};

const LOCAL: SetupAnswers = {
  ...SERVER,
  profile: 'local',
  license: { file: '' },
  domains: {
    storefront: 'http://localhost:53300',
    admin: 'http://localhost:53200',
    api: 'http://localhost:53000',
  },
  brand: { ...COMPLETE_ANSWERS.brand, logoPath: '' },
  storage: { driver: 'local' },
  mail: { ...SERVER.mail, transport: 'console', devRedirectTo: 'me@example.test' },
  turnstile: { enabled: false },
  seo: {},
  demoCatalogue: true,
};

function seeded(): Record<string, string> {
  return {
    [path.resolve(ROOT, 'license.json')]: '{"claims":{},"signature":"x"}',
    [path.resolve(ROOT, 'logo.png')]: 'PNG',
    [path.join(ROOT, 'prisma', 'search_fts_setup.sql')]: '-- fts',
    // The templates come from the real tree through the renderer, which reads
    // them with fs, not through the shell.
  };
}

async function install(answers: SetupAnswers, shell: RecordingShell = recordingShell(seeded())) {
  const out = output();
  const ports = fakePorts();
  const ctx = installContext(
    answers,
    ROOT,
    shell,
    ports,
    out,
    () => new Date('2026-09-06T00:00:00Z'),
  );
  await runInstall(ctx);
  return { ctx, shell, out, ports };
}

describe('layoutFor', () => {
  it('puts each profile in its own directory with the right env files and TLS hosts', () => {
    const both = layoutFor(SERVER, ROOT);
    expect(both.dir).toBe(path.join(ROOT, 'deploy', 'engine'));
    expect(both.engineEnvFile).toBe(path.join(ROOT, '.env.production'));
    expect(both.storefrontEnvFile).toBe(path.join(ROOT, 'apps', 'storefront', '.env.production'));
    expect(both.tlsHosts.map((h) => `${h.template}:${h.host}`)).toEqual([
      'api:api.atlas.example',
      'admin:admin.atlas.example',
      'storefront:atlas.example',
    ]);
    const local = layoutFor(LOCAL, ROOT);
    expect(local.dir).toBe(path.join(ROOT, 'deploy', 'local'));
    expect(local.engineEnvFile).toBe(path.join(ROOT, 'deploy', 'local', '.env'));
    expect(local.tlsHosts).toEqual([]);
    const storefront = layoutFor({ ...SERVER, profile: 'storefront' }, ROOT);
    expect(storefront.engineEnvFile).toBeNull();
    expect(storefront.tlsHosts.map((h) => h.host)).toEqual(['atlas.example']);
  });
});

describe('the engine install on one box (profile both)', () => {
  it('runs every step in the plan order and ends with both closing lines', async () => {
    const { ctx, shell, out } = await install(SERVER);
    expect(installSteps(ctx).map((s) => s.id)).toEqual([
      'write-outputs',
      'upload-logo',
      'build-images',
      'database-up',
      'schema',
      'seed',
      'owner',
      'tls',
      'stack-up',
      'timers',
      'smoke',
    ]);
    // Nothing public answers before the seed and the owner are done: the
    // first command that opens a port comes after the last seed command.
    const order = commandLines(shell);
    const firstPublic = order.findIndex((l) => l.includes('up -d nginx'));
    const lastSeed = order
      .map((l) => l.includes('prisma db seed') || l.includes('create-admin.ts'))
      .lastIndexOf(true);
    expect(firstPublic).toBeGreaterThan(lastSeed);
    const lines = commandLines(shell);
    const compose = `docker compose -f ${ctx.layout.composeFile} --env-file ${ctx.layout.composeEnvFile}`;
    expect(lines).toContain(`${compose} build`);
    expect(lines).toContain(`${compose} up -d postgres redis`);
    expect(lines).toContain(`${compose} up -d nginx`);
    expect(lines.filter((l) => l.includes('certbot certonly --webroot'))).toHaveLength(3);
    expect(lines).toContain(`${compose} exec nginx nginx -s reload`);
    expect(lines).toContain(`${compose} up -d`);
    expect(lines).toContain(`${compose} run --rm api npx prisma db push --accept-data-loss`);
    expect(
      lines.some((l) =>
        l.startsWith(
          'docker exec -i themerchantengine-postgres psql -U postgres -d merchants_engine -v ON_ERROR_STOP=1 -f -',
        ),
      ),
    ).toBe(true);
    expect(lines).toContain(
      `${compose} run --rm api npx ts-node --transpile-only prisma/apply-notification-indexes.ts`,
    );
    const seed = lines.find((l) => l.includes('prisma db seed')) ?? '';
    expect(seed).toContain('SEED_SCOPE=notifications-rbac');
    expect(seed).toContain(`STORE_CONFIG_FILE=/app/config/${CLIENT_CONFIG_FILE}`);
    expect(seed).toContain('SEED_SHIPPING_FLAT_RATE=7');
    expect(seed).toContain('STORE_LOGO_URL=https://atlas-assets.s3.gra.example/brand/logo.png');
    expect(lines.some((l) => l.includes('create-admin.ts --from-env'))).toBe(true);
    expect(lines).toContain(
      `sudo env ENV_FILE=${ctx.layout.composeEnvFile} bash ${path.join(ROOT, 'deploy', 'shared', 'install-cert-renew-timer.sh')}`,
    );
    expect(lines).toContain('sudo systemctl enable --now themerchantengine-pg-backup.timer');
    expect(out.text).toContain('backend server installed successfully!');
    expect(out.text).toContain('storefront server installed successfully!');
    expect(out.text).not.toContain(ctx.secrets.STOREFRONT_REVALIDATE_SECRET);
    expect(shell.probes).toEqual([
      'https://api.atlas.example/health',
      'https://api.atlas.example/api/v1/store/config',
      'https://admin.atlas.example/',
      'https://atlas.example/',
    ]);
  });

  it('never puts the owner password or a secret on a command line', async () => {
    const { shell, ctx } = await install(SERVER);
    const joined = commandLines(shell).join('\n');
    expect(joined).not.toContain('CorrectHorse9x');
    expect(joined).not.toContain(ctx.secrets.DB_PASSWORD);
    expect(joined).not.toContain('SK');
    const owner = shell.commands.find((c) => c.args.includes('--from-env'));
    expect(owner?.opts.env).toEqual({ ADMIN_PASSWORD: 'CorrectHorse9x' });
    expect(owner?.args).toContain('ADMIN_PASSWORD');
  });

  it('writes the env files, the config, the compose file and the vhosts', async () => {
    const { shell, ctx } = await install(SERVER);
    const env = parseEnv(shell.readFile(ctx.layout.engineEnvFile as string));
    expect(env.NODE_ENV).toBe('production');
    expect(env.LICENSE_FILE).toBe('/app/config/license.json');
    const storefrontEnv = parseEnv(shell.readFile(ctx.layout.storefrontEnvFile as string));
    expect(storefrontEnv.STOREFRONT_REVALIDATE_SECRET).toBe(env.STOREFRONT_REVALIDATE_SECRET);
    expect(shell.files.has(path.join(ROOT, CLIENT_CONFIG_FILE))).toBe(true);
    expect(shell.files.has(path.join(ctx.layout.configDir, 'license.json'))).toBe(true);
    expect(shell.files.has(path.join(ctx.layout.configDir, 'invoice-logo.png'))).toBe(true);
    const compose = shell.readFile(ctx.layout.composeFile);
    expect(compose).toContain('name: themerchantengine');
    expect(compose).toContain('VITE_TURNSTILE_SITE_KEY: "0xSITE"');
    expect(compose).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(shell.readFile(path.join(ctx.layout.nginxDir, '00-http.conf'))).toContain(
      'server_name api.atlas.example admin.atlas.example atlas.example www.atlas.example;',
    );
    expect(shell.readFile(path.join(ctx.layout.nginxDir, '10-admin.conf'))).toContain(
      'location /api/',
    );
    // The browser's same-origin /v1 calls reach the API container on a one-box install.
    const storefrontVhost = shell.readFile(path.join(ctx.layout.nginxDir, '10-storefront.conf'));
    expect(storefrontVhost).toContain('set $api_v1 http://api:53000;');
    expect(storefrontVhost).toContain('rewrite ^/v1/(.*)$ /api/v1/$1 break;');
    expect(storefrontVhost).toContain('proxy_set_header Host api.atlas.example;');
    expect(shell.readFile(path.join(ctx.layout.indexNowDir, 'abcdef1234567890.txt'))).toBe(
      'abcdef1234567890\n',
    );
  });

  it('uploads the logo to the bucket', async () => {
    const { ports } = await install(SERVER);
    const put = ports.calls.find((c) => c.name === 's3Put');
    expect(put?.args[1]).toBe('brand/logo.png');
    expect(put?.args[3]).toBe('image/png');
  });

  it('is idempotent: a second run keeps the secrets and skips the issued certificates', async () => {
    const first = await install(SERVER);
    const shell = first.shell;
    shell.commands = [];
    shell.responses.push({
      match: 'certbot certificates',
      result: {
        code: 0,
        stdout:
          'Certificate Name: api.atlas.example\nCertificate Name: admin.atlas.example\nCertificate Name: atlas.example\n',
      },
    });
    shell.responses.push({ match: 'SELECT 1 FROM pg_roles', result: { code: 0, stdout: '1\n' } });
    shell.responses.push({
      match: 'SELECT 1 FROM pg_database',
      result: { code: 0, stdout: '1\n' },
    });
    const engineEnvBefore = shell.readFile(first.ctx.layout.engineEnvFile as string);
    const storefrontEnvBefore = shell.readFile(first.ctx.layout.storefrontEnvFile as string);
    const second = await install(SERVER, shell);
    // The files, not the in-memory set: what the containers read is what has
    // to stay the same, and every secret those files carry is in them. The
    // assertion names the changed line rather than dumping two files.
    const changedLines = (before: string, after: string) =>
      after
        .split('\n')
        .filter((line, i) => line !== before.split('\n')[i])
        .map((line) => line.replace(/=.*$/, '=…'));
    expect(
      changedLines(engineEnvBefore, shell.readFile(second.ctx.layout.engineEnvFile as string)),
    ).toEqual([]);
    expect(
      changedLines(
        storefrontEnvBefore,
        shell.readFile(second.ctx.layout.storefrontEnvFile as string),
      ),
    ).toEqual([]);
    const lines = commandLines(shell);
    expect(lines.filter((l) => l.includes('certonly'))).toHaveLength(0);
    // The SQL is on stdin, not on the command line.
    expect(shell.commands.filter((c) => c.opts.input?.includes('CREATE DATABASE'))).toHaveLength(0);
    expect(shell.commands.filter((c) => c.opts.input?.includes('CREATE USER'))).toHaveLength(0);
    expect(second.out.text).toContain('certificate already issued');
    expect(parseEnv(shell.readFile(second.ctx.layout.engineEnvFile as string)).DB_PASSWORD).toBe(
      first.ctx.secrets.DB_PASSWORD,
    );
  });

  it('fails the install when a smoke probe never answers', async () => {
    const shell = recordingShell(seeded());
    shell.probeStatus = 502;
    await expect(install(SERVER, shell)).rejects.toThrow(InstallFailed);
    await expect(install(SERVER, recordingShell(seeded()))).resolves.toBeDefined();
  });

  it('fails the install when the admin door answers without its security headers', async () => {
    const shell = recordingShell(seeded());
    shell.probeHeaders = {};
    await expect(install(SERVER, shell)).rejects.toThrow(/security headers at .* answered 200/);
    const noFrameAncestors = recordingShell(seeded());
    noFrameAncestors.probeHeaders = {
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'",
    };
    await expect(install(SERVER, noFrameAncestors)).rejects.toThrow(
      /security headers at .* answered 200/,
    );
    const noSniff = recordingShell(seeded());
    delete noSniff.probeHeaders['x-content-type-options'];
    await expect(install(SERVER, noSniff)).rejects.toThrow(/security headers at .* answered 200/);
  });
});

describe('the local profile', () => {
  it('skips TLS and timers, runs under development, and seeds the demo catalogue', async () => {
    const { ctx, shell, out } = await install(LOCAL);
    expect(installSteps(ctx).map((s) => s.id)).toEqual([
      'write-outputs',
      'build-images',
      'database-up',
      'schema',
      'seed',
      'owner',
      'stack-up',
      'smoke',
    ]);
    const env = parseEnv(shell.readFile(ctx.layout.engineEnvFile as string));
    expect(env.NODE_ENV).toBe('development');
    expect(env.MAIL_DEV_REDIRECT_TO).toBe('me@example.test');
    const lines = commandLines(shell);
    expect(lines.filter((l) => l.includes('FIXTURE_CATALOGUE_SEED=1'))).toHaveLength(1);
    expect(shell.commands.some((c) => c.opts.input?.includes('.disabled.'))).toBe(false);
    expect(lines.some((l) => l.includes('certbot'))).toBe(false);
    expect(lines.some((l) => l.startsWith('sudo'))).toBe(false);
    expect(shell.readFile(path.join(ctx.layout.nginxDir, '10-admin.conf'))).toContain(
      'listen 53200',
    );
    // The storefront sits behind the same edge locally, with /v1 proxied.
    const localStorefront = shell.readFile(path.join(ctx.layout.nginxDir, '10-storefront.conf'));
    expect(localStorefront).toContain('listen 53300');
    expect(localStorefront).toContain('set $api_v1 http://api:53000;');
    expect(shell.probes).toEqual([
      'http://localhost:53000/health',
      'http://localhost:53000/api/v1/store/config',
      'http://localhost:53200/',
      'http://localhost:53300/',
    ]);
    expect(out.text).toContain('backend server installed successfully!');
  });

  it('runs the api as the host user, so it can write the uploads folders setup created', async () => {
    // The folders are bind mounts the host user owns. The image's `app` user
    // has another uid, and the OS8 release rehearsal failed its first seed
    // with EACCES on /app/uploads-private.
    const { ctx, shell } = await install(LOCAL, recordingShell(seeded(), 'linux', '1000:1000'));
    const compose = shell.readFile(ctx.layout.composeFile);
    const api = compose.slice(compose.indexOf('\n  api:'), compose.indexOf('\n  admin:'));
    expect(api).toContain('user: "1000:1000"');
    expect(api).toContain('./uploads-private:/app/uploads-private');
  });

  it('keeps the image user when the host user is unknown, root, or in the root group', async () => {
    for (const hostUser of [undefined, '0:0', '1000:0']) {
      const { ctx, shell } = await install(LOCAL, recordingShell(seeded(), 'linux', hostUser));
      expect(shell.readFile(ctx.layout.composeFile)).toContain('user: "app"');
    }
  });

  it('runs the demo seed on a first install only, with the seed override, and never on a store with users', async () => {
    const first = await install({ ...SERVER, demoCatalogue: true });
    const demo = commandLines(first.shell).filter((l) => l.includes('FIXTURE_CATALOGUE_SEED=1'));
    expect(demo).toHaveLength(1);
    expect(demo[0]).toContain('SEED_DEV_OK=1');
    // A re-run: the owner exists now, so the count is not zero.
    const shell = first.shell;
    shell.commands = [];
    shell.responses.push({
      match: 'SELECT count(*) FROM "User"',
      result: { code: 0, stdout: '1\n' },
    });
    const second = await install({ ...SERVER, demoCatalogue: true }, shell);
    expect(commandLines(shell).some((l) => l.includes('FIXTURE_CATALOGUE_SEED=1'))).toBe(false);
    expect(shell.commands.some((c) => c.opts.input?.includes('.disabled.'))).toBe(false);
    expect(second.out.text).toContain('demo catalogue skipped');
  });

  it('scrambles the demo accounts on a server that asked for the demo catalogue', async () => {
    const { shell } = await install({ ...SERVER, demoCatalogue: true });
    const scramble = shell.commands.find((c) => c.opts.input?.includes('.disabled.'));
    expect(scramble).toBeDefined();
    expect(scramble?.opts.input).toBe(scrambleSeededAccountsSql());
    // The credential rows must go before the rename, or the subquery finds
    // nothing and the credentials survive.
    const sql = scramble?.opts.input ?? '';
    expect(sql.indexOf('DELETE FROM "Account"')).toBeGreaterThan(-1);
    expect(sql.indexOf('DELETE FROM "Account"')).toBeLessThan(sql.indexOf('UPDATE "User"'));
    // The credential row is what signs in; the User rename alone would leave it.
    expect(scramble?.opts.input).toMatch(/DELETE FROM "Account" WHERE "providerId" = 'credential'/);
    expect(scramble?.opts.input).toContain('"isActive" = false');
  });

  it('retires every address the seeds plant, derived from the seed sources', () => {
    // Read every email literal the seeds write, and prove each matches a
    // pattern the scramble uses. The previous guard asserted the string the
    // SQL was copied from, and missed the whole fixture-catalogue population
    // whose shared password is in this repository.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(full);
      }
    };
    walk(path.join(ROOT, 'prisma', 'seeds'));
    files.push(path.join(ROOT, 'prisma', 'seed.ts'));
    const addresses = new Set<string>();
    for (const file of files) {
      // Any quoted address, whatever its domain: a TLD filter would let a
      // seed at a new domain escape the derivation.
      for (const m of fs
        .readFileSync(file, 'utf8')
        .matchAll(/['"`]([A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)['"`]/g)) {
        addresses.add(m[1].toLowerCase());
      }
    }
    expect(addresses.size).toBeGreaterThan(10);
    const likeToRegex = (pattern: string) =>
      new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`);
    const covered = SEEDED_ACCOUNT_PATTERNS.map(likeToRegex);
    // Addresses a seed writes that are not accounts, named one by one rather
    // than by a domain rule, so a new seeded account at any domain is judged.
    const notAccounts: string[] = [];
    const uncovered = [...addresses].filter(
      (a) => !notAccounts.includes(a) && !covered.some((re) => re.test(a)),
    );
    expect(uncovered).toEqual([]);
    // The canary: a family the patterns do not know must show up here.
    expect(covered.some((re) => re.test('someone@fixture.test'))).toBe(true);
    expect(covered.some((re) => re.test('someone@elsewhere.test'))).toBe(false);
  });
});

describe('the storefront-only profile', () => {
  const STOREFRONT: SetupAnswers = {
    profile: 'storefront',
    domains: SERVER.domains,
    engine: { apiUrl: 'https://api.atlas.example', revalidateSecret: 'a'.repeat(64) },
    turnstile: { enabled: true, siteKey: '0xSITE' },
    seo: { indexNowKey: 'abcdef1234567890' }, // gitleaks:allow
  };

  it('builds, issues one certificate, brings the stack up and probes the storefront', async () => {
    const { ctx, shell, out } = await install(STOREFRONT);
    expect(installSteps(ctx).map((s) => s.id)).toEqual([
      'write-outputs',
      'build-images',
      'tls',
      'stack-up',
      'timers',
      'smoke',
    ]);
    const env = parseEnv(shell.readFile(ctx.layout.storefrontEnvFile as string));
    expect(env.STOREFRONT_REVALIDATE_SECRET).toBe('a'.repeat(64));
    expect(env.STOREFRONT_API_URL).toBe('https://api.atlas.example/api');
    const lines = commandLines(shell);
    expect(lines.filter((l) => l.includes('certonly'))).toHaveLength(1);
    expect(lines.find((l) => l.includes('certonly'))).toContain(
      '-d atlas.example -d www.atlas.example',
    );
    expect(lines.some((l) => l.includes('pg-backup'))).toBe(false);
    expect(shell.probes).toEqual(['https://atlas.example/']);
    expect(out.text).toContain('storefront server installed successfully!');
    // A storefront-only box carries the browser's /v1 calls to the engine's public API origin.
    const vhost = shell.readFile(path.join(ctx.layout.nginxDir, '10-storefront.conf'));
    expect(vhost).toContain('set $api_v1 https://api.atlas.example;');
    expect(vhost).toContain('proxy_ssl_name api.atlas.example;');
    expect(out.text).not.toContain('backend server installed successfully!');
    expect(closingLines(ctx)).toHaveLength(2);
  });

  it('tells an engine-only box where the storefront box reads the secret, without printing it', async () => {
    const { ctx } = await install({ ...SERVER, profile: 'engine' });
    const lines = closingLines(ctx).join('\n');
    expect(lines).toContain('grep STOREFRONT_REVALIDATE_SECRET .env.production');
    expect(lines).not.toContain(ctx.secrets.STOREFRONT_REVALIDATE_SECRET);
  });
});
