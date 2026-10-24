import { LOCALE_REGISTRY } from '@merchants/shared-common';
import { ADMIN_FORMAT_LOCALE, adminIntlTag } from './intl-tag';

describe('adminIntlTag', () => {
  it('reads the tag from the locale registry and pins western digits', () => {
    expect(adminIntlTag('fr')).toBe(`${LOCALE_REGISTRY.fr.intlTag}-u-nu-latn`);
    expect(adminIntlTag('ar')).toBe(`${LOCALE_REGISTRY.ar.intlTag}-u-nu-latn`);
  });

  it('defaults to the admin format locale', () => {
    expect(adminIntlTag()).toBe(adminIntlTag(ADMIN_FORMAT_LOCALE));
  });

  it('falls back to the admin format locale for a code outside the registry', () => {
    expect(adminIntlTag('xx')).toBe(adminIntlTag(ADMIN_FORMAT_LOCALE));
  });
});
