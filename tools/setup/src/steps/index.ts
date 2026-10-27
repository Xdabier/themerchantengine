import { brandStep } from './brand';
import { demoCatalogueStep } from './demo-catalogue';
import { domainsStep } from './domains';
import { identityStep } from './identity';
import { localizationStep } from './localization';
import { mailStep } from './mail';
import { moneyStep } from './money';
import { ownerStep } from './owner';
import { paymentsStep } from './payments';
import { profileStep } from './profile';
import { seoStep } from './seo';
import { storageStep } from './storage';
import { summaryStep } from './summary';
import { turnstileStep } from './turnstile';
import type { Step } from './types';

/** The steps in plan E4.3's order. */
export const STEPS: readonly Step[] = [
  profileStep,
  identityStep,
  domainsStep,
  brandStep,
  localizationStep,
  moneyStep,
  storageStep,
  mailStep,
  turnstileStep,
  seoStep,
  paymentsStep,
  ownerStep,
  demoCatalogueStep,
  summaryStep,
];

export function stepsFor(profile: string | undefined): Step[] {
  return STEPS.filter(
    (step) => !step.profiles || (profile !== undefined && step.profiles.includes(profile as never)),
  );
}
