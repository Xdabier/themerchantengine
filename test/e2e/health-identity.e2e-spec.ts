import { api } from './helpers';
import { TEST_DATABASE_URL } from './env';

/**
 * Plan H / Phase H0: the identity endpoint every e2e harness reads before it
 * writes anything.
 *
 * The point of the route is that it is reachable through the SAME base URL the
 * specs use. This suite spawns its API with `API_GLOBAL_PREFIX: ''`, so the
 * bare `/v1/health/identity` is the address the backend harness checks; the
 * admin harness spawns with the `api` prefix and reads
 * `/api/v1/health/identity`. A guard reachable at neither would prove nothing,
 * which is exactly the flaw in using `/health`: it is excluded from the global
 * prefix and answers 200 on any instance, whatever database it holds.
 */
describe('GET /v1/health/identity', () => {
  const expectedDatabase = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');

  it('reports the test env and this suite\u2019s database', async () => {
    const res = await api().get('/v1/health/identity').expect(200);

    expect(res.body.data).toEqual({ env: 'test', database: expectedDatabase });
    expect(expectedDatabase.endsWith('_test')).toBe(true);
  });

  it('is public, so no session, no cookie, no 401', async () => {
    await api().get('/v1/health/identity').expect(200);
  });

  it('answers under the global prefix the specs use, not only outside it', async () => {
    // This suite runs unprefixed, so the prefixed address must 404 here. The
    // assertion is the pair: it pins that the route is prefix-BEARING (unlike
    // `/health`), which is what makes the admin harness able to reach it
    // through its `/api` proxy.
    await api().get('/api/v1/health/identity').expect(404);
    await api().get('/health').expect(200);
  });

  it('is never cached, because a stale identity is a wrong-target run (\u00a73.15-A)', async () => {
    const res = await api().get('/v1/health/identity').expect(200);

    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['etag']).toBeUndefined();
  });

  it('names the engine in X-Powered-By, never Express (DR-36)', async () => {
    const res = await api().get('/v1/health/identity').expect(200);

    expect(res.headers['x-powered-by']).toBe('themerchantengine');
  });

  it('discloses no connection string, host, or credentials (\u00a73.7)', async () => {
    const res = await api().get('/v1/health/identity').expect(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('55433');
    expect(serialized).not.toContain('localhost');
    expect(serialized).not.toContain('postgres:');
  });
});
