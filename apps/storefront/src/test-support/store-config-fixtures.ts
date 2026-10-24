import {
  loadStoreConfigFixture,
  runtimeConfigOfFixture,
  STORE_CONFIG_FIXTURE_IDS,
  type StoreConfigFixtureId,
} from '@common/store-config-fixtures';
import { NEUTRAL_STOREFRONT_RUNTIME_CONFIG, type StorefrontRuntimeConfig } from '@storefront-types';

import { signal } from '@angular/core';
import { generatePalette } from '@common/brand';

import { StoreConfigService } from '../app/services/store-config.service';
import type { MoneyFormat } from '../lib/money';
import type { ChromeIdentity } from '../i18n';

/**
 * Scenario configs for unit specs, read from the same three files the e2e
 * harnesses and the API specs read (`test/fixtures/store-configs/`).
 *
 * Specs derive their expected money, locale and direction from these rather
 * than stating a currency or a separator of their own. That is the whole point
 * of the fixtures: an assertion written against one store's format is an
 * assertion that only ever passed for that store.
 *
 * Spec-only. Nothing under `app/` may import this file: it reads from disk.
 */

export { STORE_CONFIG_FIXTURE_IDS, type StoreConfigFixtureId };

/** The runtime config of a fixture, in the resolved shape the storefront sees. */
export function fixtureRuntimeConfig(id: StoreConfigFixtureId): StorefrontRuntimeConfig {
  // Through `runtimeConfigOfFixture`, because the file also carries an id and
  // a description block that the strict wire schema would reject.
  const fixture = runtimeConfigOfFixture(loadStoreConfigFixture(id));
  return {
    ...NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
    ...fixture,
    identity: {
      ...fixture.identity,
      storeName: fixture.identity.storeName.default,
      description: fixture.identity.description.default,
      legalName: fixture.identity.legalName.default,
      address: { ...fixture.identity.address, street: fixture.identity.address.street.default },
    },
    // The endpoint derives this on every compose; a fixture carries only the
    // input colours, so a spec that renders tokens needs it added back.
    brand: { ...fixture.brand, generatedPalette: generatePalette(fixture.brand.baseColors) },
  } as StorefrontRuntimeConfig;
}

/** The money format of a fixture, which is what most money specs need. */
export function fixtureMoney(id: StoreConfigFixtureId): MoneyFormat {
  return fixtureRuntimeConfig(id).money;
}

/**
 * The default a spec uses when it is not asserting a scenario difference.
 * `demo` is the config the visual baselines are recorded against.
 */
export const DEMO_MONEY: MoneyFormat = fixtureMoney('demo');

/**
 * A `StoreConfigService` stub backed by a scenario fixture, for component
 * specs that render money, a locale or a brand token.
 *
 * Without it a component spec falls back to the neutral config, which trades
 * in a two-decimal currency, and a rule that only breaks at three decimals
 * would never be exercised.
 */
export function fixtureStoreConfigValue(id: StoreConfigFixtureId = 'demo') {
  const config = fixtureRuntimeConfig(id);
  return {
    runtime: signal(config),
    runtimeLoaded: signal(true),
    money: signal(config.money),
    localization: signal(config.localization),
    brand: signal(config.brand),
    identity: signal(config.identity),
    domains: signal(config.domains),
    currencyCode: signal(config.money.currencyCode),
    storeName: signal(config.identity.storeName),
    contactEmail: signal(config.identity.contact.email || null),
    phone: signal(config.identity.contact.phone || null),
    logoUrl: signal(null),
    socialLinks: signal([]),
    lowStockThreshold: signal(5),
    loaded: signal(false),
    pixels: signal({
      googleAnalyticsId: null,
      metaPixelId: null,
      tiktokPixelId: null,
      snapPixelId: null,
    }),
    load: async () => undefined,
    seoLocales: signal({
      supportedLocales: config.localization.supportedLocales,
      defaultLocale: config.localization.defaultLocale,
      country: config.identity.address.country,
    }),
  };
}

/**
 * The provider form. A spec that needs to vary one value spreads
 * {@link fixtureStoreConfigValue} instead of writing its own object, so a
 * member added to the service does not silently go missing from a stub.
 */
export function provideFixtureStoreConfig(id: StoreConfigFixtureId = 'demo') {
  return { provide: StoreConfigService, useValue: fixtureStoreConfigValue(id) };
}

/**
 * The chrome identity of a fixture, resolved for one locale.
 *
 * What a `LocaleService` stub feeds `getChromeStrings`, so a spec asserts the
 * fixture's store name rather than restating one (plan E2.5, gate B). The
 * locale matters: `demo` is `Demo Store` in English and `Boutique Démo` in
 * French, which is the difference a resolved Translatable makes.
 */
export function fixtureChromeIdentity(id: StoreConfigFixtureId, locale: string): ChromeIdentity {
  const fixture = runtimeConfigOfFixture(loadStoreConfigFixture(id));
  const name = fixture.identity.storeName as Record<string, string>;
  return {
    storeName: name[locale] ?? name['default'],
    country: fixture.identity.address.country,
  };
}

/** The identity most specs stub with, matching `DEMO_MONEY`. */
export const DEMO_CHROME_IDENTITY = fixtureChromeIdentity('demo', 'en');
