/**
 * Every vhost that serves the storefront must carry the browser's /v1 calls
 * to the API. The storefront's browser-side client uses a relative base, so
 * every cart, session and analytics call lands on the storefront's own
 * origin as /v1/...; the client-era vhost proxied that to /api/v1/ and the E4
 * template dropped it, which the first manual test of an installed store
 * found as a 404 on "Add to cart". The proxy_pass must be literal and end in
 * a slash: a variable proxy_pass with a URI part replaces the request URI
 * instead of appending it, which once collapsed every /v1/* to /api/v1/.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const TEMPLATES = path.join(REPO, 'deploy', 'templates', 'nginx');

function v1Block(text: string): string | undefined {
  const start = text.indexOf('location /v1/ {');
  if (start < 0) return undefined;
  return text.slice(start, text.indexOf('\n    }', start));
}

describe.each(['storefront.conf', 'local-storefront.conf'])('%s', (template) => {
  const text = fs.readFileSync(path.join(TEMPLATES, template), 'utf8');

  it('rewrites /v1/ to /api/v1/ and proxies to a variable origin with no URI part', () => {
    const block = v1Block(text);
    expect(block, 'location /v1/').toBeDefined();
    expect(block).toMatch(/set \$api_v1 (\{\{API_UPSTREAM\}\}|https?:\/\/[a-z0-9.:-]+);/);
    expect(block).toMatch(/rewrite \^\/v1\/\(\.\*\)\$ \/api\/v1\/\$1 break;/);
    expect(block).toMatch(/proxy_pass \$api_v1;/);
    // A URI part on a variable proxy_pass replaces the request URI.
    expect(block).not.toMatch(/proxy_pass \$api_v1\//);
  });

  it('forwards the request id and the client address like every other vhost', () => {
    const block = v1Block(text) ?? '';
    expect(block).toContain('proxy_set_header X-Request-Id $request_id_out;');
    expect(block).toContain('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
  });
});

it('the rule can fail: a URI part on the variable and a missing rewrite are both refused', () => {
  const rule = (block: string) =>
    /rewrite \^\/v1\/\(\.\*\)\$ \/api\/v1\/\$1 break;/.test(block) &&
    /proxy_pass \$api_v1;/.test(block) &&
    !/proxy_pass \$api_v1\//.test(block);
  expect(rule('rewrite ^/v1/(.*)$ /api/v1/$1 break;\nproxy_pass $api_v1;')).toBe(true);
  expect(rule('proxy_pass $api_v1/api/v1/;')).toBe(false);
  expect(rule('proxy_pass $api_v1;')).toBe(false);
});

it('the local edge publishes the storefront port and the storefront container publishes none', () => {
  const compose = fs.readFileSync(
    path.join(REPO, 'deploy', 'templates', 'compose.local.yml'),
    'utf8',
  );
  const storefront = compose.slice(
    compose.indexOf('\n  storefront:'),
    compose.indexOf('\n  nginx:'),
  );
  expect(storefront).not.toMatch(/ports:/);
  const nginx = compose.slice(compose.indexOf('\n  nginx:'), compose.indexOf('\nvolumes:'));
  expect(nginx).toContain('"127.0.0.1:53300:53300"');
  expect(nginx).toMatch(/depends_on:[\s\S]*- storefront/);
});
