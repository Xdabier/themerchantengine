import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  NEUTRAL_LOCALE_SET,
  fontKitCoversLocale,
  getLocaleDefinition,
  registerScratchLocale,
  registryLocaleCodes,
  storeLocales,
} from '@common/locale';
import { resolveTranslatable } from '@common/interceptors/translatable.interceptor';

import { syncTranslatableLocaleKeys } from './dto/translatable-locale-keys.dto';
import { UpdateLocalesDto } from '../modules/settings/dto/update-locales.dto';
import { TranslatableDto as ProductTranslatableDto } from '../modules/products/dto/translatable.dto';
import { copyEntry, copyLocale } from '../modules/mail/templates/layout';
import { ogLocaleFromLocale, regionFromLocale } from '../modules/seo/locale-region';
import { supportedLocales } from '../modules/seo/seo.constants';
import { searchTextConfigs } from '../modules/search/search-text-configs';
import {
  formatInvoiceDate,
  invoiceFontFiles,
  invoiceLocaleOf,
  isRtlLocale,
  type InvoiceLocale,
} from '../modules/orders/invoice-pdf.service';
import { buildFtsSetupSqlFromRegistry } from '../../../../prisma/fts-setup-sql';

/**
 * One scratch fourth language walked through every surface that reads the
 * registry (plan LG12.6). Each surface has its own narrower spec; this one
 * proves they agree on a language that no source file names.
 */
describe('a fourth language added to the registry only', () => {
  const CODE = 'de';
  let remove: () => void;

  beforeAll(() => {
    remove = registerScratchLocale(CODE, 'ltr');
    syncTranslatableLocaleKeys();
    storeLocales.set({
      supportedLocales: ['fr', 'en', 'ar', CODE],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
      timezone: 'UTC',
    });
  });

  afterAll(() => {
    remove();
    storeLocales.set(NEUTRAL_LOCALE_SET);
  });

  it('is offered by the registry listing and enabled for the store', () => {
    expect(registryLocaleCodes()).toContain(CODE);
    expect(supportedLocales()).toContain(CODE);
  });

  it('accepts the language on the settings locales write', async () => {
    const dto = plainToInstance(UpdateLocalesDto, {
      supportedLocales: ['fr', CODE],
      defaultLocale: CODE,
    });
    expect(await validate(dto)).toEqual([]);
  });

  it('accepts a Translatable write that carries the language', async () => {
    const dto = plainToInstance(ProductTranslatableDto, {
      default: 'Wert',
      fr: 'Valeur',
      de: 'Wert',
    });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('resolves the language from a Translatable, then falls back to the default', () => {
    const value = { default: 'Wert', fr: 'Valeur', de: 'Wert-de' };
    expect(resolveTranslatable(value, CODE, 'fr')).toBe('Wert-de');
    expect(resolveTranslatable({ default: 'Wert', fr: 'Valeur' }, CODE, 'fr')).toBe('Valeur');
  });

  it('feeds the sitemap hreflang set and the region tags from the enabled locales', () => {
    expect(getLocaleDefinition(CODE)?.ogRegion).toBeDefined();
    const tags = supportedLocales().map((code) => regionFromLocale(code, 'QA'));
    expect(tags).toContain('de-QA');
    expect(supportedLocales().map((code) => ogLocaleFromLocale(code, null))).toContain('de');
  });

  it('writes the search vector and trigram index for the language', () => {
    const sql = buildFtsSetupSqlFromRegistry();
    expect(sql).toContain(`NEW.name->>'${CODE}'`);
    expect(sql).toContain(`"Product_name_${CODE}_trgm_idx"`);
  });

  it('renders mail in the store default until the language has copy', () => {
    expect(copyLocale(CODE)).toBe('fr');
    expect(copyEntry({ fr: 'TTC', en: 'VAT' }, CODE)).toBe('TTC');
  });

  it('is covered by the Latin font kit and not blocked by the Arabic one', () => {
    expect(fontKitCoversLocale('latin-rounded', CODE)).toBe(true);
    expect(fontKitCoversLocale('arabic-latin', CODE)).toBe(true);
  });

  it('typesets the invoice with the language direction and the Latin font kit', () => {
    expect(isRtlLocale(CODE as InvoiceLocale)).toBe(false);
    expect(invoiceFontFiles(CODE as InvoiceLocale).body).toBe(invoiceFontFiles('fr').body);
    expect(invoiceFontFiles(CODE as InvoiceLocale).body).not.toBe(invoiceFontFiles('ar').body);
  });

  it('renders the invoice in the language itself, with a whole page of fallback tables', () => {
    expect(invoiceLocaleOf(CODE)).toBe(CODE);
    const text = formatInvoiceDate(new Date(Date.UTC(2026, 2, 5, 12)), CODE as InvoiceLocale);
    expect(text).toMatch(/^5 \S+ 2026$/);
    expect(text).not.toContain('undefined');
  });

  it('gives the search query side the text config of the language', () => {
    const definition = getLocaleDefinition(CODE)!;
    const original = definition.textSearchConfig;
    definition.textSearchConfig = 'german';
    try {
      expect(searchTextConfigs()).toContainEqual({ config: 'german', unaccent: true });
    } finally {
      definition.textSearchConfig = original;
    }
    expect(searchTextConfigs().some((c) => c.config === 'german')).toBe(false);
  });

  it('canary: a right-to-left scratch language flips the invoice direction and font kit', () => {
    const gone = registerScratchLocale('qr', 'rtl');
    try {
      expect(isRtlLocale('qr' as InvoiceLocale)).toBe(true);
      expect(invoiceFontFiles('qr' as InvoiceLocale).body).toBe(invoiceFontFiles('ar').body);
    } finally {
      gone();
    }
  });

  it('canary: a removed language leaves every registry surface', () => {
    const gone = registerScratchLocale('qq', 'ltr');
    expect(buildFtsSetupSqlFromRegistry()).toContain(`NEW.name->>'qq'`);
    gone();
    expect(registryLocaleCodes()).not.toContain('qq');
    expect(buildFtsSetupSqlFromRegistry()).not.toContain(`NEW.name->>'qq'`);
    expect(getLocaleDefinition('qq')).toBeUndefined();
  });
});
