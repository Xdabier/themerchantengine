import { ui } from '../cli/ui';
import type { Step } from './types';

/**
 * Payments (plan E4.3): cash on delivery is on by default, since the API
 * refuses an order with no enabled tender and COD needs no credential. Stripe
 * and manual transfer are the two providers already coded; no new gateway
 * joins in this epic.
 */
export const paymentsStep: Step = {
  id: 'payments',
  title: 'Payment methods',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const payments = ctx.answers.payments ?? {};
    const cod = await ctx.prompter.confirm({
      path: 'payments.cod',
      label: 'Enable cash on delivery',
      initial: payments.cod ?? true,
    });
    const manual = await ctx.prompter.confirm({
      path: 'payments.manual',
      label: 'Enable manual bank transfer',
      initial: payments.manual ?? false,
    });
    const stripe = await ctx.prompter.confirm({
      path: 'payments.stripe',
      label: 'Enable Stripe',
      initial: payments.stripe ?? false,
    });
    let stripeApiKey = '';
    let stripeWebhookSecret = '';
    if (stripe) {
      stripeApiKey = await ctx.prompter.secret({
        path: 'payments.stripeApiKey',
        label: 'Stripe secret key (sk_live_... or sk_test_...)',
        initial: payments.stripeApiKey,
        validate: (v) =>
          /^sk_(live|test)_/.test(v)
            ? null
            : 'a Stripe secret key starts with sk_live_ or sk_test_',
      });
      stripeWebhookSecret = await ctx.prompter.secret({
        path: 'payments.stripeWebhookSecret',
        label: 'Stripe webhook signing secret (whsec_...)',
        initial: payments.stripeWebhookSecret,
        validate: (v) =>
          v.startsWith('whsec_') ? null : 'a Stripe webhook signing secret starts with whsec_',
      });
    }
    if (!cod && !manual && !stripe) {
      ui.warn(
        ctx.out,
        'no payment method enabled: the store cannot take an order until one is switched on in the admin',
      );
    }
    ctx.answers.payments = { cod, manual, stripe, stripeApiKey, stripeWebhookSecret };
  },
};
