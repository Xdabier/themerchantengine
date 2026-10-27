/**
 * The shared deploy scripts (plan E5.1). Every shell file under deploy/ parses,
 * the systemd units render with no placeholder left, the expiry sweep derives
 * its hosts from the env file the installer wrote, and the rollback script
 * touches the application containers only.
 *
 * Each script is run for real through its own probe mode rather than
 * re-implemented here, so a spec that passes is a spec that drove the code
 * path an operator's box drives.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const DEPLOY = path.join(REPO, 'deploy');
const SHARED = path.join(DEPLOY, 'shared');

/** Forward slashes, which the Git bash on Windows and every Linux shell accept. */
const posix = (p: string) => p.split(path.sep).join('/');

function bash(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [posix(script), ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('deploy shell files', () => {
  const scripts = walk(DEPLOY).filter((f) => f.endsWith('.sh'));

  it('exist in the set the installer and the manual name', () => {
    const names = scripts.map((f) => posix(path.relative(DEPLOY, f))).sort();
    expect(names).toEqual([
      'scripts/prune-images.sh',
      'scripts/rollback.sh',
      'shared/cert-expiry-alert.sh',
      'shared/certbot-renew.sh',
      'shared/install-cert-renew-timer.sh',
    ]);
  });

  it.each(walk(DEPLOY).filter((f) => f.endsWith('.sh')))('%s parses', (file) => {
    const result = spawnSync('bash', ['-n', posix(file)], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('systemd units', () => {
  const unitDir = path.join(SHARED, 'systemd');
  const units = walk(unitDir)
    .map((f) => posix(path.relative(unitDir, f)))
    .sort();

  it('are named after the product, like the pg-backup units the stepper renders', () => {
    expect(units).toEqual([
      'themerchantengine-cert-alert.service',
      'themerchantengine-cert-alert.timer',
      'themerchantengine-cert-alert@.service',
      'themerchantengine-cert-renew.service',
      'themerchantengine-cert-renew.service.d/10-onfailure.conf',
      'themerchantengine-cert-renew.timer',
    ]);
  });

  it('render through the installer with no placeholder left and the checkout path in', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-units-'));
    try {
      const result = bash(
        path.join(SHARED, 'install-cert-renew-timer.sh'),
        ['--render-only', posix(scratch)],
        { REPO_ROOT: '/srv/atlas-engine', ENV_FILE: '/srv/atlas-engine/.env.production' },
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      const rendered = walk(scratch)
        .map((f) => posix(path.relative(scratch, f)))
        .sort();
      expect(rendered).toEqual(units);
      for (const file of walk(scratch)) {
        const text = fs.readFileSync(file, 'utf8');
        expect(text, file).not.toMatch(/\{\{|\}\}/);
        expect(text, file).not.toContain('/srv/merchants-engine');
        // Every path and unit name the render produces carries the product name.
        for (const ref of text.match(/\/srv\/[A-Za-z0-9._-]+|[a-z]+-cert-[a-z@%.-]+/g) ?? []) {
          expect(ref, file).toMatch(/^\/srv\/atlas-engine|^themerchantengine-cert-/);
        }
        if (file.endsWith('.service')) {
          expect(text, file).toContain('WorkingDirectory=/srv/atlas-engine');
          expect(text, file).toContain('Environment=ENV_FILE=/srv/atlas-engine/.env.production');
        }
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses to render when a unit carries a placeholder the installer does not fill', () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-units-canary-'));
    const unitsCopy = path.join(scratch, 'units');
    fs.cpSync(unitDir, unitsCopy, { recursive: true });
    fs.appendFileSync(
      path.join(unitsCopy, 'themerchantengine-cert-renew.timer'),
      '\n# {{NOBODY_FILLS_THIS}}\n',
    );
    try {
      const result = bash(
        path.join(SHARED, 'install-cert-renew-timer.sh'),
        ['--render-only', posix(path.join(scratch, 'out'))],
        { UNITS_DIR: posix(unitsCopy) },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('NOBODY_FILLS_THIS');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('certificate expiry sweep', () => {
  const alert = path.join(SHARED, 'cert-expiry-alert.sh');

  function envFile(lines: string[]): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-alert-'));
    const file = path.join(dir, '.env.production');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  }

  it('derives the three hosts from the public base urls in the env file', () => {
    const file = envFile([
      'STOREFRONT_PUBLIC_BASE_URL=https://atlas.example',
      'ADMIN_PUBLIC_BASE_URL="https://admin.atlas.example"',
      "API_PUBLIC_BASE_URL='https://api.atlas.example/'",
      'STOREFRONT_REVALIDATE_URL=https://planted.example/api/_internal/revalidate',
      'CONTACT_FORM_RECIPIENT=hello@atlas.example',
    ]);
    try {
      const result = bash(alert, ['--hosts'], { ENV_FILE: posix(file) });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'atlas.example',
        'admin.atlas.example',
        'api.atlas.example',
      ]);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('fails closed when one of the three urls is missing', () => {
    const file = envFile([
      'STOREFRONT_PUBLIC_BASE_URL=https://atlas.example',
      'ADMIN_PUBLIC_BASE_URL=https://admin.atlas.example',
    ]);
    try {
      const result = bash(alert, ['--hosts'], { ENV_FILE: posix(file) });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('API_PUBLIC_BASE_URL');
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('addresses the alert from the store sender to the configured recipient, with the contact as the fallback', () => {
    const file = envFile([
      'STOREFRONT_PUBLIC_BASE_URL=https://atlas.example',
      'ADMIN_PUBLIC_BASE_URL=https://admin.atlas.example',
      'API_PUBLIC_BASE_URL=https://api.atlas.example',
      'RESEND_FROM_EMAIL=noreply@atlas.example',
      'CONTACT_FORM_RECIPIENT=hello@atlas.example',
    ]);
    try {
      const fallback = bash(alert, ['--reason', 'probe'], {
        ENV_FILE: posix(file),
        DRY_RUN: '1',
        // No certificate is probed: the sweep fails every host and reports.
        ALERT_HOSTS_TIMEOUT: '1',
      });
      expect(fallback.stdout).toContain('To:      hello@atlas.example');
      expect(fallback.stdout).toContain('From:    noreply@atlas.example');
      const configured = bash(alert, ['--reason', 'probe'], {
        ENV_FILE: posix(file),
        DRY_RUN: '1',
        CERT_ALERT_TO: 'oncall@atlas.example',
        ALERT_HOSTS_TIMEOUT: '1',
      });
      expect(configured.stdout).toContain('To:      oncall@atlas.example');
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('undoes the escaping the installer writes, so a value with a quote or a backslash reads back whole', () => {
    // The writer (tools/setup/src/output/env-file.ts) emits "..." with backslash escapes.
    const file = envFile([
      'STOREFRONT_PUBLIC_BASE_URL=https://atlas.example',
      'ADMIN_PUBLIC_BASE_URL=https://admin.atlas.example',
      'API_PUBLIC_BASE_URL=https://api.atlas.example',
      'RESEND_FROM_NAME="Atlas \\"Outdoor\\" C:\\\\Store"',
      "RESEND_REPLY_TO='hello@atlas.example'",
      'CERT_ALERT_TO=plain@atlas.example',
    ]);
    try {
      const get = (key: string) =>
        bash(alert, ['--get', key], { ENV_FILE: posix(file) }).stdout.trim();
      expect(get('RESEND_FROM_NAME')).toBe('Atlas "Outdoor" C:\\Store');
      expect(get('RESEND_REPLY_TO')).toBe('hello@atlas.example');
      expect(get('CERT_ALERT_TO')).toBe('plain@atlas.example');
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('answers --get from an env file that carries only the key, so the timer installer reads a key before the host derivation has any say', () => {
    const file = envFile(['RESEND_API_KEY="re_only_this"']);
    try {
      const result = bash(alert, ['--get', 'RESEND_API_KEY'], { ENV_FILE: posix(file) });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('re_only_this');
      // The same file has no hosts, so the sweep itself refuses it.
      expect(bash(alert, ['--hosts'], { ENV_FILE: posix(file) }).status).not.toBe(0);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('carries no address or host literal of its own', () => {
    const text = fs.readFileSync(alert, 'utf8');
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/cert-hosts\.txt/);
  });
});

describe('rollback', () => {
  const rollback = path.join(DEPLOY, 'scripts', 'rollback.sh');

  it('rebuilds and restarts the application services from a git ref and never touches the schema', () => {
    const result = bash(rollback, ['abc1234'], {
      ROLLBACK_DRY_RUN: '1',
      // The rendered file exists only on an installed box; the template it is
      // rendered from declares the same services.
      ROLLBACK_COMPOSE_FILE: 'deploy/templates/compose.engine.yml',
      ROLLBACK_ENV_FILE: '.env.production',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('git checkout --detach abc1234');
    expect(result.stdout).toMatch(/docker compose .* build api admin/);
    expect(result.stdout).toMatch(/docker compose .* up -d --no-deps api admin/);
    expect(result.stdout).not.toMatch(/prisma|db push|storefront/);
  });

  it('restarts the storefront service on a storefront box', () => {
    const result = bash(rollback, ['v1.0.0'], {
      ROLLBACK_DRY_RUN: '1',
      ROLLBACK_COMPOSE_FILE: 'deploy/templates/compose.storefront.yml',
      ROLLBACK_ENV_FILE: 'apps/storefront/.env.production',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/build storefront/);
    expect(result.stdout).not.toMatch(/build api/);
  });

  it('refuses a missing ref with a usage line', () => {
    const result = bash(rollback, [], { ROLLBACK_DRY_RUN: '1' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('usage');
  });
});

/** The installer's timer step calls this script by path; the name is load-bearing. */
it('the installer still calls install-cert-renew-timer.sh by its path', () => {
  const install = fs.readFileSync(
    path.join(REPO, 'tools', 'setup', 'src', 'runner', 'install.ts'),
    'utf8',
  );
  expect(install).toContain("'install-cert-renew-timer.sh'");
  expect(
    execFileSync('git', ['ls-files', 'deploy/shared/install-cert-renew-timer.sh'], {
      cwd: REPO,
      encoding: 'utf8',
    }).trim(),
  ).toBe('deploy/shared/install-cert-renew-timer.sh');
});
