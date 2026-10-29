import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The admin names the engine to technology detectors (DR-36): the generator
 * meta and `data-tme-app` in `index.html`, and `X-Powered-By` in the header
 * include every nginx location carries. The entrypoint script removes all
 * three when the operator sets TME_FINGERPRINT to off.
 */

const adminRoot = join(__dirname, '..');
const indexHtml = readFileSync(join(adminRoot, 'src', 'index.html'), 'utf8');
const nginxConf = readFileSync(join(adminRoot, 'nginx.conf'), 'utf8');
const headersConf = readFileSync(join(adminRoot, 'security-headers.conf'), 'utf8');
const script = join(adminRoot, 'docker', '40-engine-fingerprint.sh');

const GENERATOR = '<meta name="generator" content="themerchantengine" />';
const HEADER = /^add_header X-Powered-By\s+"themerchantengine"\s+always;$/m;

describe('admin engine markers', () => {
  it('ships the generator meta and the app attribute', () => {
    expect(indexHtml).toContain(GENERATOR);
    expect(indexHtml).toMatch(/<html[^>]* data-tme-app="admin"/);
  });

  it('sends X-Powered-By from the shared header include', () => {
    expect(headersConf).toMatch(HEADER);
  });

  it('includes the header set in every location that declares an add_header', () => {
    const locations = nginxConf.split(/\n\s*location\s/).slice(1);
    expect(locations.length).toBeGreaterThan(0);
    for (const block of locations) {
      const body = block.slice(0, block.indexOf('}'));
      if (body.includes('add_header')) {
        expect(body).toContain('include /etc/nginx/security-headers.conf;');
      }
    }
  });
});

const hasShell = (() => {
  try {
    execFileSync('sh', ['-c', 'command -v sed'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

(hasShell ? describe : describe.skip)('admin entrypoint opt-out', () => {
  let dir: string;
  let html: string;
  let headers: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tme-admin-'));
    html = join(dir, 'index.html');
    headers = join(dir, 'security-headers.conf');
    copyFileSync(join(adminRoot, 'src', 'index.html'), html);
    copyFileSync(join(adminRoot, 'security-headers.conf'), headers);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (flag?: string) =>
    execFileSync('sh', [script], {
      env: {
        ...process.env,
        TME_FINGERPRINT: flag ?? '',
        TME_ADMIN_HTML: html,
        TME_ADMIN_HEADERS: headers,
      },
      stdio: 'ignore',
    });

  it('keeps every marker by default', () => {
    run();
    expect(readFileSync(html, 'utf8')).toContain(GENERATOR);
    expect(readFileSync(headers, 'utf8')).toMatch(HEADER);
  });

  it.each(['off', 'OFF', 'false', '0', 'no'])('removes every marker for %s', (flag) => {
    run(flag);
    const out = readFileSync(html, 'utf8');
    expect(out).not.toContain('name="generator"');
    expect(out).not.toContain('data-tme-app');
    expect(readFileSync(headers, 'utf8')).not.toContain('X-Powered-By');
    expect(readFileSync(headers, 'utf8')).toContain('Content-Security-Policy');
  });
});
