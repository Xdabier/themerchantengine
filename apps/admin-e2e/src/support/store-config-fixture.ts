/**
 * Which scenario store config the admin e2e target was seeded from
 * (plan E0.4). The helpers live in the shared loader; this file only gives
 * admin specs a local import path.
 */
export {
  describeHarnessStoreConfig,
  harnessStoreConfigFixture,
  harnessStoreConfigFixtureId,
} from '../../../../libs/shared/common/src/store-config-fixtures';
