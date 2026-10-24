import { NEUTRAL_LOCALE_SET } from '@common/locale/store-locales';
import { PASSWORD_MIN_LENGTH, adminInputFromEnv, validateAdminInput } from './create-admin';

describe('create-admin --from-env', () => {
  const ok = {
    ADMIN_EMAIL: 'Owner@Shop.example',
    ADMIN_PASSWORD: 'CorrectHorse9x',
    ADMIN_FIRST_NAME: 'Ada',
    ADMIN_LAST_NAME: 'Owner',
  };

  it('reads the four variables and lower-cases the email', () => {
    expect(adminInputFromEnv(ok)).toEqual({
      email: 'owner@shop.example',
      password: 'CorrectHorse9x',
      firstName: 'Ada',
      lastName: 'Owner',
      locale: NEUTRAL_LOCALE_SET.defaultLocale,
    });
    expect(adminInputFromEnv({ ...ok, ADMIN_LOCALE: 'fr' }).locale).toBe('fr');
  });

  it('names the first missing variable', () => {
    const rest: NodeJS.ProcessEnv = { ...ok };
    delete rest['ADMIN_PASSWORD'];
    expect(() => adminInputFromEnv(rest)).toThrow(/ADMIN_PASSWORD is not set/);
    expect(() => adminInputFromEnv({ ...ok, ADMIN_EMAIL: '' })).toThrow(/ADMIN_EMAIL is not set/);
  });

  it('applies the same policy the interactive path applies', () => {
    expect(validateAdminInput(adminInputFromEnv(ok))).toBeNull();
    expect(validateAdminInput({ ...adminInputFromEnv(ok), email: 'nope' })).toMatch(
      /Invalid email/,
    );
    expect(
      validateAdminInput({
        ...adminInputFromEnv(ok),
        password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1),
      }),
    ).toMatch(/too short/);
    expect(validateAdminInput({ ...adminInputFromEnv(ok), firstName: ' ' })).toMatch(/required/);
  });
});
