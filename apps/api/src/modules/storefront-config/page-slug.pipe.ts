import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const PAGE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Validates `pageSlug` path params on the storefront-public sections
 * endpoint. Restricts to lowercase kebab — 1–64 characters, no leading or
 * trailing hyphen — so an attacker cannot abuse the open route to inject
 * cache-key fragments, control characters, or oversize payloads.
 */
@Injectable()
export class PageSlugPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!PAGE_SLUG_PATTERN.test(value)) {
      throw new BadRequestException(
        `Invalid pageSlug "${value}" — must be 1–64 chars, [a-z0-9-], no leading/trailing hyphen.`,
      );
    }
    return value;
  }
}
