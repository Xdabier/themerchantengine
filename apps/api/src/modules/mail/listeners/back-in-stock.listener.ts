/**
 * Back-in-stock fan-out (NE8).
 *
 * One `inventory.restocked` event → one back-in-stock email per wishlister of
 * the product. Reuses the existing wishlist as the interest signal (operator
 * decision O6 — no new schema, product-level, account-only). This is a 1→N
 * fan-out, which the 1→1 DISPATCH_TABLE resolver shape does not model, so it
 * lives as a dedicated listener rather than a dispatch-table row.
 *
 * `product.back-in-stock` is LIFECYCLE-class: the `MailService.enqueue` consent
 * gate (NE7) skips any wishlister who has not opted into lifecycle mail, and the
 * RFC 8058 unsubscribe affordance rides on the consented send. A
 * per-(user, product, day) dedupe key bounds re-notify storms when stock flaps
 * around zero — without a schema change.
 *
 * Never rethrows: a mail-bridge failure must not disturb the inventory mutation
 * that emitted the event. Recipient data is read via the mail module's injected
 * PrismaService (§3.1) — never another module's service internals.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail.service';
import { resolveLocale } from './locale.util';
import { buildProductUrl } from '../dispatch/url.util';
import { INVENTORY_EVENTS } from '../../inventory/inventory.constants';
import type { MailLocale } from '../mail.types';
import { pickLocale } from '../templates/render';

interface RestockedPayload {
  variantId: string;
  productId?: string | null;
  sku?: string | null;
  quantity?: number;
}

/**
 * Resolve a Translatable name to the recipient locale, through the one shared
 * chain. This was a local copy with its own `en` then `ar` order, which is not
 * a stale comment but a divergence: a French-only product name reaching an
 * English recipient fell through to a rung that no longer exists and the mail
 * went out with an empty product name.
 */
function pickName(name: unknown, locale: MailLocale): string {
  if (name && typeof name === 'object') {
    return pickLocale(name as Record<string, string | undefined>, locale);
  }
  return typeof name === 'string' ? name : '';
}

@Injectable()
export class BackInStockListener {
  private readonly logger = new Logger(BackInStockListener.name);

  constructor(
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @OnEvent(INVENTORY_EVENTS.RESTOCKED, { async: true })
  async onRestocked(payload: RestockedPayload): Promise<void> {
    const productId = payload?.productId;
    if (!productId) return; // a variant with no resolvable product — nothing to notify

    try {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { name: true, slug: true, deletedAt: true },
      });
      if (!product || product.deletedAt) return; // unlisted / soft-deleted product

      const wishlisters = await this.prisma.wishlistItem.findMany({
        where: { productId, user: { deletedAt: null, isActive: true } },
        select: { userId: true, user: { select: { email: true, locale: true } } },
      });
      if (!wishlisters.length) return;

      const day = new Date().toISOString().slice(0, 10);

      for (const w of wishlisters) {
        if (!w.user?.email) continue;
        const locale = resolveLocale(w.user.locale);
        // Built per recipient, not once for the batch: the link carries the
        // reader's own locale segment.
        const productUrl = buildProductUrl(this.config, locale, product.slug);
        // The enqueue consent gate (NE7) decides per recipient whether this
        // lifecycle mail is actually sent; here we simply offer it.
        await this.mail.enqueue('product.back-in-stock', {
          to: w.user.email,
          locale,
          variables: {
            productName: pickName(product.name, locale),
            productUrl,
          },
          // Bound re-notify storms: at most one notice per (user, product, day)
          // even if stock flaps around zero within the BullMQ retention window.
          dedupeKey: `backinstock:${w.userId}:${productId}:${day}`,
        });
      }
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(`back-in-stock fan-out failed for product ${productId}: ${reason}`);
      // Risk R10 — preserve the "audit row is source of truth" contract.
      await this.mail.recordEnqueueFailure('product.back-in-stock', '(unresolved)', reason, {
        event: INVENTORY_EVENTS.RESTOCKED,
        productId,
      });
    }
  }
}
