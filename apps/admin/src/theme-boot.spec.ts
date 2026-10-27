import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The colour-mode boot script and the CSP that lets it run.
 *
 * `apps/admin/nginx.conf` sets `script-src 'self'`, so an inline script needs
 * an explicit hash of its exact text. Nothing in the build recomputes that
 * hash, and nothing in development notices when it is wrong: the dev server
 * sends no CSP at all, so a stale hash ships green through every local run
 * and every Playwright suite, and is discovered in production as an admin
 * that renders in the wrong colour mode for one paint and then corrects
 * itself, which reads as a flicker rather than as a blocked script.
 *
 * The script is also asserted to be a single line. A newline inside it is one
 * more byte that differs between a CRLF checkout and an LF one, so the hash
 * would hold on the machine that computed it and fail everywhere else.
 */

const adminRoot = join(__dirname, '..');
const indexHtml = readFileSync(join(adminRoot, 'src', 'index.html'), 'utf8');
// The CSP moved to its own include so every nginx location carries it;
// the hash is read from there.
const nginxConf = readFileSync(join(adminRoot, 'security-headers.conf'), 'utf8');

const inlineScripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  ([, body]) => body,
);

describe('admin colour-mode boot script', () => {
  it('is the only inline script in the document', () => {
    expect(inlineScripts).toHaveLength(1);
  });

  it('is one line, so its hash does not depend on the checkout line endings', () => {
    expect(inlineScripts[0]).not.toContain('\n');
    expect(inlineScripts[0]).not.toContain('\r');
  });

  it('reads the same storage key and the same values as ThemeStore', () => {
    const script = inlineScripts[0];
    expect(script).toContain("localStorage.getItem('admin-theme')");
    expect(script).toContain("s==='dark'||s==='light'");
    expect(script).toContain('(prefers-color-scheme: light)');
    expect(script).toContain("setAttribute('data-theme',m)");
  });

  it('falls back to dark, which is the reference floor', () => {
    expect(inlineScripts[0]).toMatch(/^var m='dark';/);
  });

  it('is allowed by a CSP hash of its exact text', () => {
    const digest = createHash('sha256').update(inlineScripts[0], 'utf8').digest('base64');
    expect(nginxConf).toContain(`'sha256-${digest}'`);
  });

  it('does not reach for unsafe-inline to get there', () => {
    const scriptSrc = /script-src ([^;]+);/.exec(nginxConf);
    expect(scriptSrc).not.toBeNull();
    expect(scriptSrc?.[1]).not.toContain('unsafe-inline');
  });
});

describe('admin nginx security headers', () => {
  // nginx drops the inherited add_header set the moment a location declares
  // one of its own; the admin once shipped with no headers on the document
  // for exactly that reason. Every location has to carry the include.
  const fullNginxConf = readFileSync(join(adminRoot, 'nginx.conf'), 'utf8');
  const locations = [...fullNginxConf.matchAll(/location[^{]*\{([\s\S]*?)\n\s*\}/g)].map(
    ([, body]) => body,
  );

  it('includes security-headers.conf in every location block', () => {
    expect(locations.length).toBeGreaterThanOrEqual(3);
    for (const body of locations) {
      expect(body).toContain('include /etc/nginx/security-headers.conf;');
    }
  });

  it('would catch a location that drops the include', () => {
    // The canary: the same extraction over a config with one bare location.
    const broken = fullNginxConf.replace(
      'location = /healthz {\n      include /etc/nginx/security-headers.conf;',
      'location = /healthz {',
    );
    expect(broken).not.toBe(fullNginxConf);
    const bodies = [...broken.matchAll(/location[^{]*\{([\s\S]*?)\n\s*\}/g)].map(([, b]) => b);
    expect(bodies.some((b) => !b.includes('include /etc/nginx/security-headers.conf;'))).toBe(true);
  });
});
