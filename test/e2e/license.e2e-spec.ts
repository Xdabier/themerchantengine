/**
 * The license verdict endpoint (plan E1.5.3, DR-31).
 *
 * The e2e API is booted with the valid test license
 * (`test/fixtures/license/valid.license.json`, bound to the demo domains and
 * localhost) and the test public key, so the verdict a real admin session
 * reads is `valid`; the invalid, expired and missing branches are unit-tested
 * against the same fixtures because each of them is a different boot.
 *
 * Real dockerized DB per constitution §3.8; nothing here writes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ADMIN, CUSTOMER1, api, loginAs } from './helpers';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures', 'license');
const fixture = (name: string): Buffer => fs.readFileSync(path.join(FIXTURES, name));

describe('GET /v1/admin/license', () => {
  let adminCookie: string;
  let customerCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    customerCookie = await loginAs(CUSTOMER1.email, CUSTOMER1.password);
  });

  it('is not anonymous', async () => {
    await api().get('/v1/admin/license').expect(401);
  });

  it('needs license:view', async () => {
    await api().get('/v1/admin/license').set('Cookie', customerCookie).expect(403);
  });

  it('reports the valid test license with its claims and no grace window', async () => {
    const res = await api().get('/v1/admin/license').set('Cookie', adminCookie).expect(200);
    expect(res.body.data).toMatchObject({
      status: 'valid',
      reason: null,
      graceEndsAt: null,
      claims: { id: 'lic-fixture-0001', plan: 'studio', storeCap: 3 },
    });
    expect(res.body.data.claims.domains).toContain('localhost');
    expect(typeof res.body.data.verifiedAt).toBe('string');
    expect(res.body.data.daysToExpiry).toBeGreaterThan(30);
  });

  it('re-verifies on demand and answers the same', async () => {
    const res = await api()
      .get('/v1/admin/license')
      .query({ fresh: '1' })
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.data.status).toBe('valid');
  });

  it('refuses a license write through the settings PATCH', async () => {
    const res = await api()
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({ status: 'valid', claims: { plan: 'forged' }, verifiedAt: '2026-01-01T00:00:00.000Z' })
      .expect(400);
    expect(res.body.error).toBeDefined();
  });

  it('keeps the verdict off the settings read, which settings:view alone can open', async () => {
    const res = await api().get('/v1/admin/settings').set('Cookie', adminCookie).expect(200);
    expect(res.body.data).not.toHaveProperty('license');
  });

  it('never leaks the verdict on the public config', async () => {
    const res = await api().get('/v1/store/config').expect(200);
    expect(res.body.data).not.toHaveProperty('license');
  });
});

/**
 * Plan E3.5.4. The install route is the only write in the license module, and
 * the property worth an e2e is the order: the engine verifies against its
 * baked key and its configured origins before it writes, so a refused upload
 * leaves the running install exactly as it was.
 *
 * The harness points `LICENSE_FILE` at a per-run copy of the valid fixture
 * (see `test/e2e-global-setup.ts`), so these cases write to scratch rather
 * than to the tracked file every other license test reads.
 */
describe('POST /v1/admin/license/install', () => {
  let adminCookie: string;
  let customerCookie: string;

  beforeAll(async () => {
    adminCookie = await loginAs(ADMIN.email, ADMIN.password);
    customerCookie = await loginAs(CUSTOMER1.email, CUSTOMER1.password);
  });

  afterAll(async () => {
    // Whatever a case installed, put the run back on the license it booted on.
    await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .attach('file', fixture('valid.license.json'), 'valid.license.json')
      .expect(200);
  });

  it('is not anonymous', async () => {
    await api()
      .post('/v1/admin/license/install')
      .attach('file', fixture('valid.license.json'), 'valid.license.json')
      .expect(401);
  });

  it('is refused for a session without license:manage', async () => {
    await api()
      .post('/v1/admin/license/install')
      .set('Cookie', customerCookie)
      .attach('file', fixture('valid.license.json'), 'valid.license.json')
      .expect(403);
  });

  it('installs a license that verifies and answers with its verdict', async () => {
    const res = await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .attach('file', fixture('valid.license.json'), 'valid.license.json')
      .expect(200);

    expect(res.body.data.status).toBe('valid');
    expect(res.body.data.claims).toBeTruthy();
  });

  it('refuses a file signed by a key the engine does not trust', async () => {
    const res = await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .attach('file', fixture('untrusted.license.json'), 'untrusted.license.json')
      .expect(400);

    expect(res.body.error.code).toBe('LICENSE_REFUSED');
  });

  it('leaves the running verdict untouched after a refusal', async () => {
    await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .attach('file', fixture('tampered.license.json'), 'tampered.license.json')
      .expect(400);

    const res = await api().get('/v1/admin/license?fresh=1').set('Cookie', adminCookie).expect(200);
    expect(res.body.data.status).toBe('valid');
  });

  it('refuses a file larger than a license can be', async () => {
    // The cap is enforced by multer, so it is true today by the behaviour of a
    // pinned dependency and by nothing this repository asserts. A parser that
    // truncated instead of aborting would hand `install` the first 16 KB of a
    // larger file, which is a different document than the one that was signed.
    const oversize = Buffer.alloc(17 * 1024, 0x20);

    await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .attach('file', oversize, 'huge.license.json')
      .expect(413);
  });

  it('refuses a second part appended alongside the license', async () => {
    // What this pins is the route's contract, not the limit that enforces it:
    // `files: 1` and `fields: 0` are what refuse these two requests, and both
    // cases stay green with `parts` deleted. The direction `parts` matters for
    // is the opposite one, and the happy-path install above is what catches a
    // `parts: 1` that refuses the only upload the route exists for.
    await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .attach('file', fixture('valid.license.json'), 'valid.license.json')
      .attach('extra', fixture('valid.license.json'), 'extra.license.json')
      .expect((res) => {
        if (res.status < 400) {
          throw new Error(`expected a refusal, got ${res.status}`);
        }
      });
  });

  it('refuses a text field sent alongside the license', async () => {
    await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .field('path', '/etc/passwd')
      .attach('file', fixture('valid.license.json'), 'valid.license.json')
      .expect((res) => {
        if (res.status < 400) {
          throw new Error(`expected a refusal, got ${res.status}`);
        }
      });
  });

  it('refuses a request with no file attached', async () => {
    const res = await api()
      .post('/v1/admin/license/install')
      .set('Cookie', adminCookie)
      .expect(400);

    expect(res.body.error.code).toBe('LICENSE_FILE_MISSING');
  });
});
