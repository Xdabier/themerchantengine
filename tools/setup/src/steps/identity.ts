import { STORE_CONFIG_BUSINESS_TYPES } from '../../../../libs/shared/common/src/store-config-fixtures/store-config-fixture.schema';
import { isCountryCode, isE164, isEmail, type Step } from './types';

/**
 * Store identity (plan E4.3): the names, the contact and the legal address.
 * Translatable text is asked once here, in the store's own words, and the
 * config writer fills every supported locale with it; the admin's identity
 * screen is where the per-locale wording is refined later.
 */
export const identityStep: Step = {
  id: 'identity',
  title: 'Store identity',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const identity = ctx.answers.identity ?? {};
    const one = (value: Record<string, string> | undefined) => value?.['default'];

    const storeName = await ctx.prompter.text({
      path: 'identity.storeName.default',
      label: 'Store name',
      initial: one(identity.storeName),
      validate: (v) => (v.trim().length > 0 ? null : 'the store needs a name'),
    });
    const brandName = await ctx.prompter.text({
      path: 'identity.brandName',
      label: 'Brand name (one word, rendered verbatim)',
      initial:
        identity.brandName ??
        storeName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      validate: (v) =>
        /^[a-z0-9][a-z0-9-]*$/.test(v) ? null : 'lowercase letters, digits and hyphens only',
    });
    const description = await ctx.prompter.text({
      path: 'identity.description.default',
      label: 'One-line description',
      initial: one(identity.description) ?? '',
    });
    const legalName = await ctx.prompter.text({
      path: 'identity.legalName.default',
      label: 'Legal entity name',
      initial: one(identity.legalName) ?? '',
    });
    const contactEmail = await ctx.prompter.text({
      path: 'identity.contactEmail',
      label: 'Contact email',
      initial: identity.contactEmail,
      validate: (v) => (isEmail(v) ? null : 'not an email address'),
    });
    const contactPhone = await ctx.prompter.text({
      path: 'identity.contactPhone',
      label: 'Contact phone (E.164, +33100000000, or empty)',
      initial: identity.contactPhone ?? '',
      validate: (v) =>
        v === '' || isE164(v) ? null : 'use the E.164 form: + then digits, no spaces',
    });
    const street = await ctx.prompter.text({
      path: 'identity.street.default',
      label: 'Street address',
      initial: one(identity.street) ?? '',
    });
    const locality = await ctx.prompter.text({
      path: 'identity.locality',
      label: 'City',
      initial: identity.locality ?? '',
    });
    const region = await ctx.prompter.text({
      path: 'identity.region',
      label: 'Region or state (or empty)',
      initial: identity.region ?? '',
    });
    const postalCode = await ctx.prompter.text({
      path: 'identity.postalCode',
      label: 'Postal code (or empty)',
      initial: identity.postalCode ?? '',
    });
    const country = await ctx.prompter.text({
      path: 'identity.country',
      label: 'Country (ISO 3166-1 alpha-2, FR)',
      initial: identity.country,
      validate: (v) => (isCountryCode(v) ? null : 'two upper-case letters'),
    });
    const businessType = await ctx.prompter.select({
      path: 'identity.businessType',
      label: 'Business type',
      initial: identity.businessType ?? 'OnlineStore',
      choices: STORE_CONFIG_BUSINESS_TYPES.map((value) => ({ value, label: value })),
    });

    ctx.answers.identity = {
      ...identity,
      storeName: { ...(identity.storeName ?? {}), default: storeName },
      brandName,
      description: { ...(identity.description ?? {}), default: description },
      legalName: { ...(identity.legalName ?? {}), default: legalName },
      contactEmail,
      contactPhone,
      street: { ...(identity.street ?? {}), default: street },
      locality,
      region,
      postalCode: postalCode === '' ? null : postalCode,
      country,
      areaServed: identity.areaServed ?? [country],
      businessType,
    };
  },
};
