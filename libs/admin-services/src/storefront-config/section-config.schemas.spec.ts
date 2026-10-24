import { describe, expect, it } from '@jest/globals';
import { heroSectionConfigSchema, promotionalBannerConfigSchema } from './section-config.schemas';

const validTranslatable = { default: 'x' };
const validAssetId = '11111111-1111-4111-8111-111111111111';

const validHero = (ctaHref: string) => ({
  assetId: validAssetId,
  eyebrow: validTranslatable,
  headline: validTranslatable,
  body: validTranslatable,
  cta: validTranslatable,
  ctaHref,
});

const validPromo = (ctaHref?: string) => ({
  assetId: validAssetId,
  eyebrow: validTranslatable,
  headline: validTranslatable,
  body: validTranslatable,
  ...(ctaHref === undefined ? {} : { ctaHref }),
});

describe('heroSectionConfigSchema.ctaHref (S21.7a — H-2 admin-security-reviewer fix)', () => {
  it.each(['/catalog', '/catalog/product/x', 'https://example.com', 'http://example.com'])(
    'accepts %s',
    (value) => {
      expect(heroSectionConfigSchema.safeParse(validHero(value)).success).toBe(true);
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://evil.com',
    'mailto:a@b',
    'tel:+1',
    '//evil.com',
    '//evil.com/x',
    '\\\\evil.com',
    'evil.com',
    '   /catalog',
    '',
  ])('rejects %s', (value) => {
    expect(heroSectionConfigSchema.safeParse(validHero(value)).success).toBe(false);
  });
});

describe('promotionalBannerConfigSchema.ctaHref (optional but allowlisted)', () => {
  it('accepts a missing ctaHref', () => {
    expect(promotionalBannerConfigSchema.safeParse(validPromo()).success).toBe(true);
  });

  it.each(['/catalog', 'https://example.com'])('accepts %s', (value) => {
    expect(promotionalBannerConfigSchema.safeParse(validPromo(value)).success).toBe(true);
  });

  it.each(['javascript:alert(1)', '//evil.com', 'evil.com'])('rejects %s', (value) => {
    expect(promotionalBannerConfigSchema.safeParse(validPromo(value)).success).toBe(false);
  });
});
