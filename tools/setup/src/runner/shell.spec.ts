import * as http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Output } from '../cli/ui';
import { describeCommand, dryRunShell, realShell, redactSecrets } from './shell';

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

const SECRET_ENV = [
  '# header',
  'NODE_ENV="production"',
  'DB_PASSWORD="deadbeef0123"',
  'DATABASE_URL="postgresql://merchants_app:deadbeef0123@postgres:5432/merchants_engine"',
  'RESEND_API_KEY="re_live_9999"',
  'TURNSTILE_SECRET="0xSECRET"',
  'STOREFRONT_REVALIDATE_SECRET=""',
  'S3_BUCKET="atlas-assets"',
].join('\n');

describe('redactSecrets', () => {
  it('hides every secret-shaped value and keeps the rest readable', () => {
    const shown = redactSecrets(SECRET_ENV);
    for (const secret of ['deadbeef0123', 're_live_9999', '0xSECRET']) {
      expect(shown).not.toContain(secret);
    }
    expect(shown).toContain('DB_PASSWORD="…redacted…"');
    expect(shown).toContain('DATABASE_URL="…redacted…"');
    expect(shown).toContain('STOREFRONT_REVALIDATE_SECRET=""');
    expect(shown).toContain('S3_BUCKET="atlas-assets"');
    expect(shown).toContain('NODE_ENV="production"');
  });
});

describe('dryRunShell', () => {
  const base = { exists: () => false, readFile: () => '', readBinary: () => Buffer.alloc(0) };

  it('withholds a 0600 file whole and redacts a secret-shaped line elsewhere', () => {
    const out = output();
    const shell = dryRunShell(out, base);
    shell.writeFile('/srv/x/.env.production', SECRET_ENV, 0o600);
    shell.writeFile('/srv/x/docker-compose.yml', 'services:\n  api:\n    env_file: .env\n');
    shell.writeFile('/srv/x/notes.env', 'API_KEY="k-123"\nNAME="x"\n');
    expect(out.text).toContain('contents withheld');
    for (const secret of ['deadbeef0123', 're_live_9999', '0xSECRET', 'k-123']) {
      expect(out.text, secret).not.toContain(secret);
    }
    expect(out.text).toContain('env_file: .env');
    expect(out.text).toContain('NAME="x"');
  });

  it('runs nothing and answers a probe as reachable', async () => {
    const out = output();
    const shell = dryRunShell(out, base);
    const result = await shell.run('docker', ['compose', 'up'], { env: { ADMIN_PASSWORD: 'p' } });
    expect(result).toEqual({ code: 0, stdout: '' });
    expect(out.text).toContain('[dry-run] $ ADMIN_PASSWORD=… docker compose up');
    expect(out.text).not.toContain("'p'");
    await expect(shell.probe('http://localhost:1/')).resolves.toEqual({
      status: 200,
      body: '',
      headers: {},
    });
  });
});

describe('describeCommand', () => {
  it('masks environment values and quotes an argument with a space', () => {
    expect(describeCommand('env', ['A=b c', 'bash'], { env: { SECRET: 'x' } })).toBe(
      'SECRET=… env "A=b c" bash',
    );
  });
});

describe('realShell.probe', () => {
  let server: http.Server;
  let url: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      res.statusCode = req.url === '/missing' ? 404 : 200;
      res.end('{"data":{"status":"ok"}}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('returns the status, the body and the lower-cased headers', async () => {
    const shell = realShell(output());
    const ok = await shell.probe(`${url}/`);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('"ok"');
    expect(ok.headers['x-frame-options']).toBe('DENY');
    expect(ok.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect((await shell.probe(`${url}/missing`)).status).toBe(404);
  });

  it('answers 0 when nothing listens', async () => {
    const shell = realShell(output());
    const closed = await shell.probe('http://127.0.0.1:1/');
    expect(closed).toEqual({ status: 0, body: '', headers: {} });
  });
});
