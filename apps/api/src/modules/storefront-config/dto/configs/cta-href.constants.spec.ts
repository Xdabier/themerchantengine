import { describe, expect, it } from '@jest/globals';
import { CTA_HREF_SCHEME_REGEX } from './cta-href.constants';

describe('CTA_HREF_SCHEME_REGEX (S21.7a — H-2 admin-security-reviewer fix)', () => {
  describe('accepts', () => {
    const accepted = [
      '/catalog',
      '/catalog/product/airpods-pro',
      '/fr/catalog',
      '/?utm_source=campaign',
      'https://atlas.example/landing',
      'https://www.atlas.example/promo',
      'http://internal.test/path',
    ];
    for (const value of accepted) {
      it(`accepts ${JSON.stringify(value)}`, () => {
        expect(CTA_HREF_SCHEME_REGEX.test(value)).toBe(true);
      });
    }
  });

  describe('rejects', () => {
    const rejected = [
      'javascript:alert(document.cookie)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://evil.com/file',
      'mailto:attacker@evil.com',
      'tel:+1234567890',
      '//evil.com',
      '//evil.com/path',
      '\\/\\/evil.com',
      '\\\\evil.com',
      'evil.com',
      'evil.com/path',
      '   /catalog',
      '',
    ];
    for (const value of rejected) {
      it(`rejects ${JSON.stringify(value)}`, () => {
        expect(CTA_HREF_SCHEME_REGEX.test(value)).toBe(false);
      });
    }
  });
});
