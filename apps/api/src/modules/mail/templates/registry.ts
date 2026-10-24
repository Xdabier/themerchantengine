/**
 * Template registry — single import surface for the renderer.
 *
 * Each entry maps a `MailJobName` to the render function exported by its
 * file. Keeping this static avoids dynamic `await import(...)` in the hot
 * path of `renderTemplate` (the bundler would need lazy chunks otherwise)
 * and gives the type-checker the assurance that every job name has a
 * fallback.
 */
import type { MailBrand, MailJobName, MailLocale, RenderedTemplate } from '../mail.types';
import { copyLocale } from './layout';

import { render as passwordReset } from './auth.password-reset';
import { render as emailVerification } from './auth.email-verification';
import { render as magicLink } from './auth.magic-link';
import { render as changeEmailVerification } from './auth.change-email-verification';
import { render as deleteAccount } from './auth.delete-account';
import { render as passwordChanged } from './auth.password-changed';
import { render as emailChangeAlert } from './auth.email-change-alert';
import { render as welcome } from './customer.welcome';
import { render as orderPlaced } from './order.placed';
import { render as orderShipped } from './order.shipped';
import { render as orderDelivered } from './order.delivered';
import { render as orderCancelled } from './order.cancelled';
import { render as orderConfirmed } from './order.confirmed';
import { render as orderExchangeCreated } from './order.exchange-created';
import { render as giftcardPurchase } from './giftcard.purchase';
import { render as giftcardRedeemed } from './giftcard.redeemed';
import { render as giftcardStoreCredit } from './giftcard.store-credit';
import { render as returnRequested } from './return.requested';
import { render as returnApproved } from './return.approved';
import { render as returnRejected } from './return.rejected';
import { render as returnReceived } from './return.received';
import { render as returnRefunded } from './return.refunded';
import { render as questionAnswered } from './question.answered';
import { render as reviewApproved } from './review.approved';
import { render as cartAbandoned } from './cart.abandoned';
import { render as staffInvite } from './admin.staff-invite';
import { render as contactForm } from './contact-form';
import { render as backInStock } from './product.back-in-stock';
import { render as reviewRequest } from './review.request';
import { render as giftcardExpiryReminder } from './giftcard.expiry-reminder';
import { render as twoFactorOtp } from './auth.2fa-otp';
import { render as twoFactorEnabled } from './auth.2fa-enabled';
import { render as twoFactorDisabled } from './auth.2fa-disabled';
import { render as opsDigest } from './admin.ops-digest';
import { render as kpiDigest } from './admin.kpi-digest';
import { render as newsletterConfirm } from './newsletter.confirm';

/**
 * Every file template takes the store's brand as its third argument: the
 * renderer resolves the store name from the runtime config once per send and
 * hands it down, so no template carries a store name literal.
 */
export type Renderer = (
  locale: MailLocale,
  vars: Record<string, unknown>,
  brand: MailBrand,
) => RenderedTemplate;

const RAW_REGISTRY: Record<MailJobName, Renderer> = {
  'auth.password-reset': passwordReset as unknown as Renderer,
  'auth.email-verification': emailVerification as unknown as Renderer,
  'auth.magic-link': magicLink as unknown as Renderer,
  'auth.change-email-verification': changeEmailVerification as unknown as Renderer,
  'auth.delete-account': deleteAccount as unknown as Renderer,
  'auth.password-changed': passwordChanged as unknown as Renderer,
  'auth.email-change-alert': emailChangeAlert as unknown as Renderer,
  'customer.welcome': welcome as unknown as Renderer,
  'order.placed': orderPlaced as unknown as Renderer,
  'order.shipped': orderShipped as unknown as Renderer,
  'order.delivered': orderDelivered as unknown as Renderer,
  'order.cancelled': orderCancelled as unknown as Renderer,
  'order.confirmed': orderConfirmed as unknown as Renderer,
  'order.exchange-created': orderExchangeCreated as unknown as Renderer,
  'giftcard.purchase': giftcardPurchase as unknown as Renderer,
  'giftcard.redeemed': giftcardRedeemed as unknown as Renderer,
  'giftcard.store-credit': giftcardStoreCredit as unknown as Renderer,
  'return.requested': returnRequested as unknown as Renderer,
  'return.approved': returnApproved as unknown as Renderer,
  'return.rejected': returnRejected as unknown as Renderer,
  'return.received': returnReceived as unknown as Renderer,
  'return.refunded': returnRefunded as unknown as Renderer,
  'question.answered': questionAnswered as unknown as Renderer,
  'review.approved': reviewApproved as unknown as Renderer,
  'cart.abandoned': cartAbandoned as unknown as Renderer,
  'admin.staff-invite': staffInvite as unknown as Renderer,
  'contact-form': contactForm as unknown as Renderer,
  'product.back-in-stock': backInStock as unknown as Renderer,
  'review.request': reviewRequest as unknown as Renderer,
  'giftcard.expiry-reminder': giftcardExpiryReminder as unknown as Renderer,
  'auth.2fa-otp': twoFactorOtp as unknown as Renderer,
  'auth.2fa-enabled': twoFactorEnabled as unknown as Renderer,
  'auth.2fa-disabled': twoFactorDisabled as unknown as Renderer,
  'admin.ops-digest': opsDigest as unknown as Renderer,
  'admin.kpi-digest': kpiDigest as unknown as Renderer,
  'newsletter.confirm': newsletterConfirm as unknown as Renderer,
};

/**
 * Every render is handed the locale its copy is written in, so a locale with
 * no copy gets the store default's text and the store default's presentation.
 */
export const TEMPLATE_REGISTRY = Object.fromEntries(
  Object.entries(RAW_REGISTRY).map(([code, render]) => [
    code,
    ((locale, vars, brand) => render(copyLocale(locale), vars, brand)) as Renderer,
  ]),
) as Record<MailJobName, Renderer>;
