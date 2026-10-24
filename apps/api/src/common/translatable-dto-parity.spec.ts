import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import {
  FR_EN_LOCALE_SET,
  NEUTRAL_LOCALE_SET,
  registerScratchLocale,
  storeLocales,
} from '@common/locale';

import { syncTranslatableLocaleKeys } from './dto/translatable-locale-keys.dto';
import { CarrierTranslatableDto } from '../modules/carriers/dto/translatable.dto';
import { TranslatableDto as CategoryTranslatableDto } from '../modules/categories/dto/translatable.dto';
import { TranslatableDto as CmsTranslatableDto } from '../modules/cms/dto/translatable.dto';
import { TranslatableDto as GiftCardTranslatableDto } from '../modules/gift-cards/dto/translatable.dto';
import { PaymentTranslatableDto } from '../modules/payments/dto/translatable.dto';
import { TranslatableDto as ProductTranslatableDto } from '../modules/products/dto/translatable.dto';
import { TranslatableDto as PromotionTranslatableDto } from '../modules/promotions/dto/translatable.dto';
import { TranslatableDto as ShippingTranslatableDto } from '../modules/shipping/dto/translatable.dto';
import { TranslatableDto as StorefrontTranslatableDto } from '../modules/storefront-config/dto/translatable.dto';
import {
  OptionalTranslatableBodyDto,
  TranslatableBodyDto,
} from '../modules/notifications/dto/translatable-body.dto';
import { OptionalTranslatableDto as CarrierOptionalDto } from '../modules/carriers/dto/translatable.dto';
import { OptionalTranslatableDto as PaymentOptionalDto } from '../modules/payments/dto/translatable.dto';
import { CampaignTranslatableDto } from '../modules/campaigns/dto/campaign.dto';
import { SettingsTranslatableDto } from '../modules/settings/dto/update-settings.dto';

/**
 * `main.ts` runs `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.
 * Whitelisting is driven by class-validator DECORATOR metadata, and a TypeScript
 * index signature carries none, so a `Translatable` DTO that declares only
 * `default` rejects every other locale key it is handed. The admin renders a tab
 * per store locale on every one of these fields, which means an undeclared
 * locale is a 400 the operator sees as "could not save" with no explanation.
 *
 * This suite is the cross-module parity guard: one place that fails when a new
 * module's Translatable DTO forgets a locale, rather than one Playwright journey
 * per module discovering it separately.
 */
const MODULES: ReadonlyArray<{ name: string; dto: new () => object }> = [
  { name: 'campaigns', dto: CampaignTranslatableDto },
  { name: 'carriers', dto: CarrierTranslatableDto },
  { name: 'categories', dto: CategoryTranslatableDto },
  { name: 'cms', dto: CmsTranslatableDto },
  { name: 'gift-cards', dto: GiftCardTranslatableDto },
  { name: 'notifications', dto: TranslatableBodyDto },
  { name: 'payments', dto: PaymentTranslatableDto },
  { name: 'products', dto: ProductTranslatableDto },
  { name: 'promotions', dto: PromotionTranslatableDto },
  { name: 'settings', dto: SettingsTranslatableDto },
  { name: 'shipping', dto: ShippingTranslatableDto },
  { name: 'storefront-config', dto: StorefrontTranslatableDto },
  // The Optional variants are what the UPDATE endpoints actually bind
  // (`update-carrier.dto.ts`, `update-payment-method.dto.ts`, `template.dto.ts`),
  // so leaving them out would have left the edit path uncovered while the create
  // path looked guarded.
  { name: 'carriers (optional)', dto: CarrierOptionalDto },
  { name: 'payments (optional)', dto: PaymentOptionalDto },
  { name: 'notifications (optional)', dto: OptionalTranslatableBodyDto },
];

/** Property names class-validator will keep under `whitelist: true`. */
function whitelisted(dto: new () => object, payload: Record<string, unknown>): Promise<string[]> {
  const instance = plainToInstance(dto, payload);
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true }).then(
    (errors: ValidationError[]) => errors.map((e) => e.property),
  );
}

describe('Translatable DTO locale parity', () => {
  afterEach(() => storeLocales.set(NEUTRAL_LOCALE_SET));

  describe.each(MODULES)('$name', ({ dto }) => {
    it('accepts the store default locale key', async () => {
      const rejected = await whitelisted(dto, { default: 'Valeur', fr: 'Valeur' });
      expect(rejected).toEqual([]);
    });

    it('accepts the second store locale key', async () => {
      const rejected = await whitelisted(dto, { default: 'Value', en: 'Value' });
      expect(rejected).toEqual([]);
    });

    it('accepts both store locales at once, which is what the editor submits', async () => {
      const rejected = await whitelisted(dto, { default: 'Valeur', fr: 'Valeur', en: 'Value' });
      expect(rejected).toEqual([]);
    });

    it('accepts a catalogue locale the store has enabled', async () => {
      storeLocales.set({
        supportedLocales: ['ar', 'en'],
        defaultLocale: 'ar',
        rtlLocales: ['ar'],
        timezone: 'UTC',
      });
      const rejected = await whitelisted(dto, { default: 'قيمة', ar: 'قيمة', en: 'Value' });
      expect(rejected).toEqual([]);
    });

    it('rejects a catalogue locale the store has not enabled', async () => {
      // The enabled set is runtime config, so the gate cannot be a decorator
      // literal: `ar` is a declared property (the whitelist lets it through)
      // and the enabled-locale validator is what refuses it here.
      storeLocales.set(FR_EN_LOCALE_SET);
      const rejected = await whitelisted(dto, { default: 'Value', ar: 'قيمة' });
      expect(rejected).toEqual(['ar']);
    });

    it('accepts an enabled registry locale beyond fr, en and ar', async () => {
      const remove = registerScratchLocale('de');
      syncTranslatableLocaleKeys();
      try {
        storeLocales.set({
          supportedLocales: ['fr', 'de'],
          defaultLocale: 'fr',
          rtlLocales: [],
          timezone: 'UTC',
        });
        const rejected = await whitelisted(dto, { default: 'Wert', fr: 'Valeur', de: 'Wert' });
        expect(rejected).toEqual([]);
      } finally {
        remove();
      }
    });

    it('rejects a registry locale the store has not enabled', async () => {
      const remove = registerScratchLocale('de');
      syncTranslatableLocaleKeys();
      try {
        storeLocales.set(FR_EN_LOCALE_SET);
        const rejected = await whitelisted(dto, { default: 'Value', de: 'Wert' });
        expect(rejected).toEqual(['de']);
      } finally {
        remove();
      }
    });

    it('still rejects a key that is not a declared locale', async () => {
      // The guard has to stay a guard: widening for `fr` must not turn these
      // into open buckets that accept arbitrary request properties.
      const rejected = await whitelisted(dto, { default: 'Value', notALocale: 'x' });
      expect(rejected).toContain('notALocale');
    });
  });

  // The required variants bind the CREATE endpoints. An empty `default` there
  // resolves to '' under every locale for good (the order snapshots the method
  // name at placement), so every required copy has to refuse it, not just the
  // modules that happened to be written with @IsNotEmpty(). Two modules allow
  // it on purpose and are left out: a campaign's subject and body declare
  // `default` optional (a draft is saved before it is written), and a
  // notification template body left empty is what makes the mail module fall
  // back to its file-based renderer.
  const EMPTY_DEFAULT_BY_DESIGN = new Set(['campaigns', 'notifications']);
  describe.each(
    MODULES.filter((m) => !m.name.endsWith('(optional)') && !EMPTY_DEFAULT_BY_DESIGN.has(m.name)),
  )('$name (required)', ({ dto }) => {
    it('rejects an empty default', async () => {
      const rejected = await whitelisted(dto, { default: '' });
      expect(rejected).toContain('default');
    });
  });
});
