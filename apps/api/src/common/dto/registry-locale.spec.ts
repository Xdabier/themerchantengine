import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { registerScratchLocale } from '@common/locale';

import { IsRegistryLocale } from './translatable-locale-keys.dto';
import { UpdateLocalesDto } from '../../modules/settings/dto/update-locales.dto';

class SingleDto {
  @IsRegistryLocale()
  locale: string;
}

class ManyDto {
  @IsRegistryLocale({ each: true })
  locales: string[];
}

async function errorsFor<T extends object>(dto: new () => T, payload: object): Promise<string[]> {
  const errors = await validate(plainToInstance(dto, payload));
  return errors.map((e) => e.property);
}

describe('IsRegistryLocale', () => {
  it('accepts a code the registry holds', async () => {
    expect(await errorsFor(SingleDto, { locale: 'fr' })).toEqual([]);
  });

  it('rejects a code the registry does not hold', async () => {
    expect(await errorsFor(SingleDto, { locale: 'xx' })).toEqual(['locale']);
  });

  it('rejects a non-string value', async () => {
    expect(await errorsFor(SingleDto, { locale: 7 })).toEqual(['locale']);
  });

  it('checks every item with each', async () => {
    expect(await errorsFor(ManyDto, { locales: ['fr', 'xx'] })).toEqual(['locales']);
    expect(await errorsFor(ManyDto, { locales: ['fr', 'en'] })).toEqual([]);
  });

  it('sees a language added to the registry after load', async () => {
    const remove = registerScratchLocale('de');
    try {
      expect(await errorsFor(SingleDto, { locale: 'de' })).toEqual([]);
      expect(
        await errorsFor(UpdateLocalesDto, { supportedLocales: ['fr', 'de'], defaultLocale: 'de' }),
      ).toEqual([]);
    } finally {
      remove();
    }
    expect(await errorsFor(SingleDto, { locale: 'de' })).toEqual(['locale']);
  });
});
