import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { isRegistryLocale, registryLocaleCodes, storeLocales } from '@common/locale';

/**
 * Refuses a value for a locale the store has not enabled (plan E1.3.4).
 *
 * `main.ts` runs the ValidationPipe with `whitelist: true` and
 * `forbidNonWhitelisted: true`, and whitelisting is driven by decorator
 * metadata, so every catalogue locale has to be a decorated property for the
 * pipe to let it through at all. Which of those locales a store accepts is
 * runtime config, so the second gate is this validator: it reads the enabled
 * set from the process-wide snapshot the settings module keeps current, and
 * fails the property when its name is a locale the store does not run. A row
 * can therefore never gain a translation nothing will ever render.
 */
export function IsEnabledLocale(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isEnabledLocale',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          return storeLocales.isSupported(args.property);
        },
        defaultMessage(args: ValidationArguments): string {
          const enabled = storeLocales.current().supportedLocales.join(', ');
          return `locale ${args.property} is not enabled on this store (enabled: ${enabled})`;
        },
      },
    });
  };
}

/**
 * Refuses a locale VALUE the store has not enabled: the `locale` a send-test,
 * an analytics event or a newsletter signup names. Same source of truth as
 * `IsEnabledLocale`, applied to the value rather than the property name.
 */
export function IsEnabledLocaleValue(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isEnabledLocaleValue',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && storeLocales.isSupported(value);
        },
        defaultMessage(args: ValidationArguments): string {
          const enabled = storeLocales.current().supportedLocales.join(', ');
          return `${args.property} must be a locale this store has enabled (${enabled})`;
        },
      },
    });
  };
}

/**
 * Refuses a locale VALUE the language registry does not hold. For the fields
 * that choose which locales a store enables, so the enabled set cannot be the
 * gate. Reads the registry live, so a language added after load is accepted.
 */
export function IsRegistryLocale(options?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isRegistryLocale',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isRegistryLocale(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be one of the registry locales (${registryLocaleCodes().join(', ')})`;
        },
      },
    });
  };
}

/**
 * The locale keys every Translatable DTO carries: one optional string
 * property per registry locale, each gated on the store's enabled set.
 *
 * Module DTOs extend this and declare `default` themselves, because whether
 * `default` is required, non-empty or optional is a per-field decision (a name
 * must carry a value, a description may be cleared) and stays where it was.
 * class-validator reads decorator metadata through the prototype chain, so the
 * locale rules apply to every subclass unchanged.
 *
 * No locale is spelled out here (DR-33): the properties are decorated from the
 * language registry, so adding a language to the registry is the whole change.
 */
export abstract class TranslatableLocaleKeysDto {
  [locale: string]: string | undefined;
}

const decoratedLocales = new Set<string>();

/**
 * Decorates one property per registry locale on the base DTO, once each.
 * Whitelisting is metadata driven, so a registry locale needs a decorated
 * property to get past `forbidNonWhitelisted`. Runs at load; a spec that adds
 * a scratch language calls it again.
 */
export function syncTranslatableLocaleKeys(): void {
  for (const code of registryLocaleCodes()) {
    if (decoratedLocales.has(code)) continue;
    decoratedLocales.add(code);
    const target = TranslatableLocaleKeysDto.prototype;
    ApiPropertyOptional({ type: String })(target, code);
    IsOptional()(target, code);
    IsString()(target, code);
    IsEnabledLocale()(target, code);
  }
}

syncTranslatableLocaleKeys();
