import { describe, expect, it } from 'vitest';
import { STORE_CONFIG_FIXTURE_FORCE_ENV, assertFixtureAllowed } from '../../store-config-fixture';

/**
 * The fixture guard reads the environment through the shared production
 * predicate (plan E4, DR-31). It used to compare `NODE_ENV` against the one
 * string `production`, so a fixture could rewrite a live store's config under
 * `staging`, `prod` or no label at all.
 */
describe('assertFixtureAllowed', () => {
  it.each([['production'], ['staging'], ['prod'], ['Production'], [undefined]])(
    'refuses a fixture under NODE_ENV=%s without the force flag',
    (label) => {
      const env: NodeJS.ProcessEnv = label === undefined ? {} : { NODE_ENV: label };
      expect(() => assertFixtureAllowed('demo', env)).toThrow(/Refusing to seed the demo/);
    },
  );

  it.each([['production'], ['staging'], [undefined]])(
    'honours the force flag under NODE_ENV=%s',
    (label) => {
      const env: NodeJS.ProcessEnv = {
        ...(label === undefined ? {} : { NODE_ENV: label }),
        [STORE_CONFIG_FIXTURE_FORCE_ENV]: '1',
      };
      expect(() => assertFixtureAllowed('demo', env)).not.toThrow();
    },
  );

  it.each([['test'], ['development']])('allows a fixture under NODE_ENV=%s', (label) => {
    expect(() => assertFixtureAllowed('demo', { NODE_ENV: label })).not.toThrow();
  });
});
