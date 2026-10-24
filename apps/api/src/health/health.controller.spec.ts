import { HealthIdentityController } from './health.controller';

/**
 * Plan H / Phase H0: the identity endpoint the e2e harnesses read before they
 * write anything.
 *
 * `/health` answers 200 on any instance, whatever database it was started
 * against, so it can never tell a test API from a dev one. That is what let
 * e2e traffic reach the dev database for two weeks in May. This endpoint is
 * the missing identity, and §3.7 bounds what it may say: the database NAME in
 * test mode, never the URL, never credentials, and nothing but the env word
 * anywhere else.
 */
describe('HealthIdentityController.identity', () => {
  const OLD_ENV = process.env.NODE_ENV;
  const OLD_URL = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.NODE_ENV = OLD_ENV;
    process.env.DATABASE_URL = OLD_URL;
  });

  function identity() {
    return new HealthIdentityController().identity();
  }

  it('reports the env and the database NAME under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:55433/merchants_engine_test';

    expect(identity()).toEqual({ env: 'test', database: 'merchants_engine_test' });
  });

  it('drops query parameters from the database name', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:55433/merchants_engine_test?schema=public&connection_limit=5';

    expect(identity().database).toBe('merchants_engine_test');
  });

  it('never leaks the connection string, the host, or the credentials', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL =
      'postgresql://postgres:hunter2@db.internal:55433/merchants_engine_test';

    const serialized = JSON.stringify(identity());
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('postgres:');
    expect(serialized).not.toContain('db.internal');
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('/');
  });

  it('reports the env alone outside test mode, with no database key at all', () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@prod-db:5432/merchants_engine';

    const payload = identity();
    expect(payload).toEqual({ env: 'production' });
    expect('database' in payload).toBe(false);
  });

  it('reports development when NODE_ENV is unset, and still no database key', () => {
    delete process.env.NODE_ENV;
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:55432/merchants_engine_dev';

    expect(identity()).toEqual({ env: 'development' });
  });

  it('reports an unknown database rather than throwing on an unparseable URL', () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'not-a-url';

    expect(identity()).toEqual({ env: 'test', database: 'unknown' });
  });

  it('reports an unknown database rather than throwing when DATABASE_URL is unset', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.DATABASE_URL;

    expect(identity()).toEqual({ env: 'test', database: 'unknown' });
  });
});
