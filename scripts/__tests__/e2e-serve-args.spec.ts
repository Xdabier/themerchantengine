import { describe, expect, it } from 'vitest';
// @ts-expect-error plain CommonJS script without a declaration file
import { serveAdminArgs } from '../../apps/admin-e2e/e2e-serve-args.cjs';

// On Linux the Angular dev server bound `localhost` to [::1] only, while the
// setup's identity fetch went to 127.0.0.1 and was refused. The launcher pins
// the IPv4 loopback so every client reaches the same socket on every OS.

describe('admin e2e serve args', () => {
  const args = serveAdminArgs({ proxyConfigPath: '/state/proxy.json', adminPort: '53211' });

  it('binds the dev server to the IPv4 loopback', () => {
    expect(args).toContain('--host=127.0.0.1');
  });

  it('keeps the generated proxy config and the requested port', () => {
    expect(args).toEqual(
      expect.arrayContaining(['--proxyConfig=/state/proxy.json', '--port=53211']),
    );
  });

  it('serves the admin project through nx', () => {
    expect(args.slice(0, 3)).toEqual(['nx', 'serve', 'admin']);
  });
});
