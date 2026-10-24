import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CartVariantNotFoundException } from './cart-variant-not-found.exception';
import { CartInsufficientStockException } from './cart-insufficient-stock.exception';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { tryPickVariantUrl } from '@common/asset-variants';
import { buildVariantLabel } from '@common/utils';
import * as money from '@common/money';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PromotionsService } from '../promotions/promotions.service';
import { CartItemDto } from '../promotions/dto/validate-coupon.dto';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { ShippingService } from '../shipping/shipping.service';
import { TaxService } from '../tax/tax.service';
import { WishlistService } from '../wishlist/wishlist.service';
import type { AddItemDto } from './dto/add-item.dto';
import type { UpdateItemDto } from './dto/update-item.dto';
import type { EstimateShippingDto } from './dto/estimate-shipping.dto';
import { CART_EVENTS, CROSS_SELL_STUB } from './cart.constants';

// ── Public response types ─────────────────────────────────────────────────────

export type DiscountLine = {
  promotionId: string;
  label: unknown; // Translatable JSON
  amount: number;
  type: 'coupon' | 'automatic';
};

export type CartItemResponse = {
  id: string;
  variantId: string;
  /**
   * The product and its first category, as the promotions engine needs them.
   *
   * Order creation used to build its promo items with empty ids, so any
   * promotion restricted to certain products or categories applied on the cart
   * and silently evaporated at order create. Emitting them here gives both
   * sides one source, which is what stops them diverging again.
   */
  productId: string;
  categoryId: string | null;
  /**
   * The product's live Translatable name, which the global locale interceptor
   * resolves against the request's `Accept-Language`.
   *
   * `addItem` snapshots the name once, as `name.default`, and this used to
   * return that snapshot verbatim. On a catalogue whose default value is the
   * French string, a cart opened under `/en` showed French line names for a
   * product whose English name the API already had loaded. Falls back to the
   * snapshot string when the product is gone, which is the only name left at
   * that point. Orders keep their own JSON snapshot and are untouched.
   */
  productName: unknown;
  variantLabel: string | null;
  productSlug: string;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  lineTotal: number;
  inStock: boolean;
  stockAvailable: number;
  thumbnailUrl: string | null;
  weight: number | null;
};

export type FreeShippingProgressResponse = {
  threshold: number | null;
  remaining: number | null;
  qualified: boolean;
};

export type CartResponse = {
  id: string;
  items: CartItemResponse[];
  subtotal: number;
  discounts: DiscountLine[];
  shippingEstimate: number | null;
  /** Standard shipping method name (Translatable JSON) when a store default is
   *  resolvable for the cart; null otherwise. */
  shippingMethodName: unknown | null;
  taxEstimate: number | null;
  freeShippingProgress: FreeShippingProgressResponse | null;
  total: number;
  /** Shipping-inclusive amount (total + shippingEstimate) the storefront shows;
   *  equals `total` when no shipping is resolvable. Tax-EXCLUSIVE: the cart
   *  page labels this `HT` per `plan.md` §2.2. */
  grandTotal: number;
  /**
   * The tax-inclusive amount, `grandTotal + taxEstimate`, which the checkout
   * summary labels `TTC`.
   *
   * A distinct field rather than folding tax into `grandTotal`, because §2.2
   * wants both figures visible: the catalogue and cart quote HT, and the TTC
   * total appears at checkout. Equals `grandTotal` until a delivery country is
   * known, since `taxEstimate` is only populated once the address resolves a
   * tax zone.
   */
  grandTotalTtc: number;
  itemCount: number;
  couponCode: string | null;
  /**
   * The gift card applied on the cart, with the amount it would actually
   * cover. Null when none is applied, and also null when a previously applied
   * card has since expired or been emptied: the cart reads it back through
   * `checkBalance` on every load rather than trusting the stored code.
   *
   * `balanceApplied` is capped at `grandTotalTtc`, the same base
   * `OrdersService.createOrder` caps against, so the figure the cart shows is
   * the figure the order will deduct. It is an estimate to the same extent
   * `shippingEstimate` and `taxEstimate` are: the order recomputes both from
   * the delivery address and re-caps.
   */
  giftCard: { code: string; balanceApplied: number } | null;
  crossSellProductIds: string[];
};

export type GiftCardValidationResult = {
  currentBalance: number;
  currency: string;
  expiresAt: Date | null;
};

export type ShippingEstimateResponse = {
  rates: {
    methodId: string;
    name: unknown;
    price: number;
    isDefault: boolean;
    estimatedDaysMin: number | null;
    estimatedDaysMax: number | null;
  }[];
  taxEstimate: number | null;
};

// ── Prisma include shape for full cart ───────────────────────────────────────

const CART_ITEM_INCLUDE = {
  variant: {
    select: {
      id: true,
      price: true,
      compareAtPrice: true,
      weight: true,
      isActive: true,
      productId: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          categories: { take: 1, select: { categoryId: true } },
          assets: {
            where: { isPrimary: true },
            take: 1,
            select: {
              asset: { select: { id: true, status: true, variants: true } },
            },
          },
        },
      },
    },
  },
} as const;

// ── Service ───────────────────────────────────────────────────────────────────

/** Attempts for the serializable cart merge before the failure is surfaced. */
const MERGE_MAX_ATTEMPTS = 3;

/**
 * A Postgres serialization failure, in every shape this stack reports it.
 *
 * The same conflict arrives three different ways, which is why this is a
 * function rather than one equality check:
 *
 *   - `P2034` — Prisma's "Transaction failed due to a write conflict or a
 *     deadlock", raised when the conflict is detected mid-statement.
 *   - `TransactionWriteConflict` — a `DriverAdapterError` from
 *     `@prisma/adapter-pg`, raised when the conflict is only detected at
 *     COMMIT. It carries no `code` at all, so a `P2034`-only check lets it
 *     through to a 500. That is exactly what happened here.
 *   - SQLSTATE `40001` (serialization failure) and `40P01` (deadlock
 *     detected), if the driver ever surfaces the raw code.
 */
function isSerializationFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === 'P2034' || code === '40001' || code === '40P01') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('TransactionWriteConflict');
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly promotions: PromotionsService,
    private readonly giftCards: GiftCardsService,
    private readonly shipping: ShippingService,
    private readonly tax: TaxService,
    private readonly wishlist: WishlistService,
    private readonly events: EventEmitter2,
  ) {}

  // ── Public: get full cart ─────────────────────────────────────────────────

  async getCart(userId?: string, sessionId?: string): Promise<CartResponse> {
    const cart = await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      include: { items: { include: CART_ITEM_INCLUDE } },
    });

    if (!cart || !cart.items.length) {
      return this.emptyCart(cart?.id);
    }

    // Live stock check for all items in parallel
    const stockResults = await Promise.all(
      cart.items.map((item) => this.inventory.checkAvailability(item.variantId)),
    );

    const itemResponses: CartItemResponse[] = cart.items.map((item, i) => {
      const stock = stockResults[i];
      const livePrice = toNum(item.variant.price);
      const lineTotal = money.lineTotal(livePrice, item.quantity);
      return {
        id: item.id,
        variantId: item.variantId,
        productId: item.variant.productId,
        categoryId: item.variant.product.categories[0]?.categoryId ?? null,
        productName: item.variant.product?.name ?? item.productName,
        variantLabel: item.variantLabel,
        productSlug: item.productSlug,
        unitPrice: livePrice,
        compareAtPrice: item.variant.compareAtPrice ? toNum(item.variant.compareAtPrice) : null,
        quantity: item.quantity,
        lineTotal,
        inStock: stock.available > 0,
        stockAvailable: stock.available,
        thumbnailUrl:
          tryPickVariantUrl(item.variant.product.assets[0]?.asset, 'thumbnail')?.url ??
          item.thumbnailUrl ??
          null,
        weight: item.variant.weight ? toNum(item.variant.weight) : null,
      };
    });

    const subtotal = money.sumMoney(itemResponses.map((i) => i.lineTotal));

    // Build CartItemDto[] for promotions engine
    const promoItems: CartItemDto[] = cart.items.map((item) => ({
      productId: item.variant.productId,
      categoryId: item.variant.product.categories[0]?.categoryId ?? '',
      quantity: item.quantity,
      unitPrice: toNum(item.variant.price),
    }));

    // Automatic promotions + coupon + free-shipping progress (parallel)
    const [automaticDiscounts, freeShippingProgress] = await Promise.all([
      this.promotions.getApplicableAutomatic(subtotal, promoItems, userId),
      this.promotions.getFreeShippingProgress(subtotal),
    ]);

    const discounts: DiscountLine[] = automaticDiscounts.map((d) => ({
      promotionId: d.promotionId,
      label: d.label,
      amount: d.discountAmount,
      type: 'automatic',
    }));

    // Coupon discount — use stored amount (validated at apply-time)
    if (cart.couponCode) {
      const couponDiscount =
        toNum(cart.discountAmount) - automaticDiscounts.reduce((s, d) => s + d.discountAmount, 0);
      if (couponDiscount > 0) {
        discounts.push({
          promotionId: '',
          label: { default: cart.couponCode, en: cart.couponCode, fr: cart.couponCode },
          amount: couponDiscount,
          type: 'coupon',
        });
      }
    }

    const totalDiscount = money.sumMoney(discounts.map((d) => d.amount));
    const total = Math.max(0, money.roundMoney(subtotal - totalDiscount));

    // Resolve the store's standard shipping for the cart, before any address is
    // known. Pure read; only yields a value when there is exactly one store-wide
    // default method (the QA-only single-zone case). A previously-cached,
    // address-specific estimate takes precedence over the pre-address default.
    const storeDefault = await this.shipping.getStoreDefaultRate({
      items: itemResponses.map((i) => ({ weight: i.weight ?? 0, quantity: i.quantity })),
      subtotal,
    });
    const persistedEstimate = cart.shippingEstimate != null ? toNum(cart.shippingEstimate) : null;
    const resolvedEstimate = persistedEstimate ?? storeDefault?.price ?? null;
    // A FREE_SHIPPING promotion is returned by the engine with a zero discount
    // amount and the comment that it is a signal, honoured at checkout. Nothing
    // honoured it: the cart said "qualified", listed a zero-amount discount row
    // and still added the full estimate, and the placed order charged it.
    //
    // Keyed off the applicable-automatic list rather than `freeShippingProgress`
    // because only the former respects eligibility, per-user limits and the
    // minimum; the progress helper is a subtotal-threshold display aid.
    // Applied after the estimate resolves so it covers both the cached
    // address-specific figure and the pre-address store default.
    const freeShipping = automaticDiscounts.some((d) => d.type === 'FREE_SHIPPING');
    const shippingEstimate = freeShipping && resolvedEstimate != null ? 0 : resolvedEstimate;
    const grandTotal = money.sumMoney([total, shippingEstimate ?? 0]);
    const taxEstimate = cart.taxEstimate ? toNum(cart.taxEstimate) : null;
    const grandTotalTtc = money.sumMoney([grandTotal, taxEstimate ?? 0]);

    const giftCard = await this.resolveAppliedGiftCard(cart.giftCardCode, grandTotalTtc);

    return {
      id: cart.id,
      items: itemResponses,
      subtotal,
      discounts,
      shippingEstimate,
      shippingMethodName: storeDefault?.name ?? null,
      taxEstimate,
      freeShippingProgress: {
        threshold: freeShippingProgress.threshold,
        remaining: freeShippingProgress.remaining,
        qualified: freeShippingProgress.qualified,
      },
      total,
      grandTotal,
      grandTotalTtc,
      itemCount: itemResponses.reduce((s, i) => s + i.quantity, 0),
      couponCode: cart.couponCode ?? null,
      giftCard,
      crossSellProductIds: CROSS_SELL_STUB,
    };
  }

  // ── Public: add item ──────────────────────────────────────────────────────

  async addItem(
    dto: AddItemDto,
    userId?: string,
    sessionId?: string,
    locale = 'default',
  ): Promise<CartResponse> {
    // Fetch variant with product info
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: dto.variantId },
      select: {
        id: true,
        price: true,
        compareAtPrice: true,
        weight: true,
        isActive: true,
        deletedAt: true,
        productId: true,
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            deletedAt: true,
            assets: {
              where: { isPrimary: true },
              take: 1,
              select: {
                asset: { select: { id: true, status: true, variants: true } },
              },
            },
          },
        },
        attributeValues: {
          // Ordered so the snapshotted label is stable across writes and
          // matches what `prisma/backfill-variant-labels.ts` rebuilds.
          orderBy: [{ attributeValue: { sortOrder: 'asc' } }, { attributeValueId: 'asc' }],
          select: { attributeValue: { select: { value: true } } },
        },
      },
    });

    if (!variant || variant.deletedAt || !variant.isActive || variant.product.deletedAt) {
      throw new CartVariantNotFoundException();
    }

    // Snapshot the variant label as resolved text. The column is plain text,
    // so the locale interceptor never sees it (finding AD2).
    const variantLabel = buildVariantLabel(variant.attributeValues, locale);

    // Snapshot product name — default locale
    const productName =
      (variant.product.name as Record<string, string>)?.default ?? String(variant.product.name);

    const isNew = !(await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      select: { id: true },
    }));

    // Get or create cart
    const cart = await this.getOrCreate(userId, sessionId);

    // Upsert cart item (increment quantity if variant already in cart)
    const existingItem = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: dto.variantId } },
    });

    // Live stock check, against the CUMULATIVE quantity the line would carry
    // after this add. Checking `dto.quantity` alone let repeated adds to the
    // same line each pass individually while their sum oversold the variant
    // (two adds of 99 against 142 on hand: 99 < 142 both times, 198 > 142
    // never checked). `updateItem` below already compares against the total
    // it is setting the line to; this makes `addItem` consistent with it.
    const stock = await this.inventory.checkAvailability(dto.variantId);
    const requestedTotal = (existingItem?.quantity ?? 0) + dto.quantity;
    if (stock.available < requestedTotal) {
      throw new CartInsufficientStockException();
    }

    if (existingItem) {
      await this.prisma.cartItem.update({
        where: { cartId_variantId: { cartId: cart.id, variantId: dto.variantId } },
        data: { quantity: { increment: dto.quantity } },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          variantId: dto.variantId,
          quantity: dto.quantity,
          productName,
          variantLabel,
          productSlug: variant.product.slug,
          unitPrice: variant.price,
          compareAtPrice: variant.compareAtPrice ?? null,
          inStock: stock.available > 0,
          stockAvailable: stock.available,
          thumbnailUrl:
            tryPickVariantUrl(variant.product.assets[0]?.asset, 'thumbnail')?.url ?? null,
          weight: variant.weight ?? null,
        },
      });
    }

    await this.recalculateTotals(cart.id, userId);

    this.events.emit(isNew ? 'cart.created' : 'cart.updated', {
      cartId: cart.id,
      userId,
      sessionId,
    });

    return this.getCart(userId, sessionId);
  }

  // ── Public: update item quantity ──────────────────────────────────────────

  async updateItem(
    itemId: string,
    dto: UpdateItemDto,
    userId?: string,
    sessionId?: string,
  ): Promise<CartResponse> {
    const cart = await this.requireCart(userId, sessionId);
    const item = await this.requireItem(cart.id, itemId);

    const stock = await this.inventory.checkAvailability(item.variantId);
    if (stock.available < dto.quantity) {
      throw new CartInsufficientStockException();
    }

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: {
        quantity: dto.quantity,
        inStock: stock.available > 0,
        stockAvailable: stock.available,
      },
    });

    await this.recalculateTotals(cart.id, userId);
    this.events.emit('cart.updated', { cartId: cart.id, userId, sessionId });

    return this.getCart(userId, sessionId);
  }

  // ── Public: remove item ───────────────────────────────────────────────────

  async removeItem(itemId: string, userId?: string, sessionId?: string): Promise<CartResponse> {
    const cart = await this.requireCart(userId, sessionId);
    await this.requireItem(cart.id, itemId);

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    await this.recalculateTotals(cart.id, userId);
    this.events.emit('cart.updated', { cartId: cart.id, userId, sessionId });

    return this.getCart(userId, sessionId);
  }

  // ── Public: clear cart ────────────────────────────────────────────────────

  async clearCart(userId?: string, sessionId?: string): Promise<void> {
    const cart = await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      select: { id: true },
    });
    if (!cart) return;

    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: {
        subtotal: 0,
        discountAmount: 0,
        giftCardCode: null,
        total: 0,
        couponCode: null,
        // An emptied cart that keeps its estimates reports a VAT charge on
        // nothing: `getCart` reads both columns regardless of item count.
        shippingEstimate: null,
        taxEstimate: null,
      },
    });
    this.events.emit('cart.updated', { cartId: cart.id, userId, sessionId });
  }

  // ── Public: apply coupon ──────────────────────────────────────────────────

  async applyCoupon(code: string, userId?: string, sessionId?: string): Promise<CartResponse> {
    const cart = await this.requireCartWithItems(userId, sessionId);

    const promoItems = await this.buildPromoItems(cart.id);
    const subtotal = await this.computeSubtotal(cart.id);

    const validated = await this.promotions.validateCoupon(code, subtotal, promoItems, userId);

    // Store coupon code and its discount amount
    const autoDiscounts = await this.promotions.getApplicableAutomatic(
      subtotal,
      promoItems,
      userId,
    );
    const autoTotal = autoDiscounts.reduce((s, d) => s + d.discountAmount, 0);
    const totalDiscount = autoTotal + validated.discountAmount;

    await this.prisma.cart.update({
      where: { id: cart.id },
      data: {
        couponCode: code,
        discountAmount: totalDiscount,
        total: Math.max(0, subtotal - totalDiscount),
        // A coupon lowers the discounted goods total the VAT is charged on, so
        // an estimate quoted before it applied is now too high. This method
        // writes its own update instead of going through `recalculateTotals`,
        // so it needs the clearing that lives there.
        shippingEstimate: null,
        taxEstimate: null,
      },
    });

    this.events.emit('cart.updated', { cartId: cart.id, userId, sessionId });

    return this.getCart(userId, sessionId);
  }

  // ── Public: remove coupon ─────────────────────────────────────────────────

  async removeCoupon(userId?: string, sessionId?: string): Promise<CartResponse> {
    const cart = await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      select: { id: true },
    });
    if (!cart) return this.emptyCart();

    await this.recalculateTotals(cart.id, userId, null);
    this.events.emit('cart.updated', { cartId: cart.id, userId, sessionId });

    return this.getCart(userId, sessionId);
  }

  // ── Public: apply gift card ───────────────────────────────────────────────

  /**
   * Validate a gift card and attach it to the cart.
   *
   * This used to validate and return `{ currentBalance, currency, expiresAt }`
   * without persisting anything, on the reasoning that the client would hold
   * the code and pass it at checkout. Three things were wrong with that. The
   * storefront parsed the response as a full cart, so every valid card threw a
   * ZodError that surfaced to the shopper as "this gift card is not valid";
   * the cart page rendered its applied state from `cart.giftCard`, a field the
   * backend never emitted; and the checkout payload spread
   * `cart.giftCard?.code`, so the code never reached the order either. The
   * tender was unreachable end to end.
   *
   * `checkBalance` throws on an unknown, inactive, expired or empty card, so
   * an invalid code never reaches the write.
   */
  async applyGiftCard(code: string, userId?: string, sessionId?: string): Promise<CartResponse> {
    const cart = await this.requireCartWithItems(userId, sessionId);

    await this.giftCards.checkBalance(code);

    await this.prisma.cart.update({ where: { id: cart.id }, data: { giftCardCode: code } });
    this.events.emit('cart.updated', { cartId: cart.id, userId, sessionId });

    return this.getCart(userId, sessionId);
  }

  // ── Public: remove gift card ──────────────────────────────────────────────

  async removeGiftCard(userId?: string, sessionId?: string): Promise<void> {
    const cart = await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      select: { id: true },
    });
    if (!cart) return;

    await this.prisma.cart.update({ where: { id: cart.id }, data: { giftCardCode: null } });
    this.events.emit('cart.updated', { cartId: cart.id, userId, sessionId });
  }

  /**
   * Read the applied card back, capped at what the cart can actually consume.
   *
   * A stored code is not a promise that the card is still good: it can expire,
   * be emptied by another order, or be deactivated by an admin between the
   * apply and the next page load. Rather than trusting the column, this asks
   * `checkBalance` every time and reports nothing when the answer is no. The
   * column is left alone: clearing it here would be a write on a read path,
   * and `OrdersService` re-validates before it deducts anything.
   */
  private async resolveAppliedGiftCard(
    code: string | null,
    cappedAt: number,
  ): Promise<{ code: string; balanceApplied: number } | null> {
    if (!code) return null;
    try {
      const { currentBalance } = await this.giftCards.checkBalance(code);
      return { code, balanceApplied: money.roundMoney(Math.min(currentBalance, cappedAt)) };
    } catch {
      return null;
    }
  }

  // ── Public: shipping + tax estimate ──────────────────────────────────────

  async estimateShipping(
    dto: EstimateShippingDto,
    userId?: string,
    sessionId?: string,
  ): Promise<ShippingEstimateResponse> {
    const cart = await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      include: { items: { select: { quantity: true, weight: true, unitPrice: true } } },
    });

    if (!cart || !cart.items.length) {
      return { rates: [], taxEstimate: null };
    }

    const subtotal = money.sumMoney(
      cart.items.map((i) => money.lineTotal(toNum(i.unitPrice), i.quantity)),
    );

    // The VAT base is the discounted goods total, per `plan.md` §2.7, so the
    // estimate the cart shows matches the tax the order will actually carry.
    // `Cart.discountAmount` is the amount validated at apply-time.
    const taxableBase = Math.max(0, money.roundMoney(subtotal - toNum(cart.discountAmount)));

    const [rates, taxResult] = await Promise.all([
      this.shipping.calculateRates({
        country: dto.country,
        postalCode: dto.postalCode,
        items: cart.items.map((i) => ({
          weight: i.weight ? toNum(i.weight) : 0,
          quantity: i.quantity,
        })),
        subtotal,
      }),
      this.tax.calculateTax(dto.country, null, taxableBase),
    ]);

    // Cache the DEFAULT method's rate (not the lowest) so the cached estimate
    // matches what createOrder will actually charge — one source of truth for
    // the default, eliminating the prior lowest-vs-first-by-sortOrder divergence.
    const defaultRate = this.shipping.resolveDefaultRate(rates);
    await this.prisma.cart.update({
      where: { id: cart.id },
      data: {
        shippingEstimate: defaultRate ? defaultRate.price : null,
        taxEstimate: taxResult.amount > 0 ? taxResult.amount : null,
      },
    });

    return { rates, taxEstimate: taxResult.amount > 0 ? taxResult.amount : null };
  }

  // ── Public: save for later ────────────────────────────────────────────────

  async saveForLater(itemId: string, userId: string): Promise<CartResponse> {
    const cart = await this.requireCart(userId, undefined);
    const item = await this.requireItem(cart.id, itemId);

    // Look up the productId via the variant
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: item.variantId },
      select: { productId: true },
    });
    if (!variant) throw new CartVariantNotFoundException();

    // Add to wishlist and remove from cart
    await this.wishlist.addItem(userId, variant.productId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    await this.recalculateTotals(cart.id, userId);
    this.events.emit('cart.updated', { cartId: cart.id, userId });

    return this.getCart(userId, undefined);
  }

  // ── Public: merge anonymous cart into user cart (§9.4 C5) ────────────────

  async mergeAnonymousCart(userId: string, sessionId: string): Promise<void> {
    await this.runMergeTransaction(userId, sessionId);

    // Recalculate totals outside the serializable tx (reads-only ok here)
    const userCart = await this.prisma.cart.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (userCart) await this.recalculateTotals(userCart.id, userId);

    // Announce the merge so the orders module can claim any guest order placed
    // in this session. AWAITED, not fired and forgotten: the endpoint clears
    // the `sessionId` cookie immediately after this returns, and that cookie is
    // the only key to those orders. A listener that lands a moment later would
    // leave a window where the customer can reach their order by neither route.
    await this.events.emitAsync(CART_EVENTS.MERGED, { userId, sessionId });
  }

  /**
   * The merge itself, retried on a serialization failure.
   *
   * Serializable does not promise a transaction succeeds; it promises that if
   * it does, the result was equivalent to some serial order. Postgres enforces
   * that by aborting one side of a conflict with `40001`, which Prisma reports
   * as `P2034`. Retrying is the caller's job.
   *
   * Nothing exercised this until the merge got a production caller. The
   * storefront shell fires it at boot while the SSR render and the cart-badge
   * hydration are reading the same rows, which conflicted on roughly one
   * sign-in in twelve: a 500 on the customer's first authenticated page load,
   * and their guest basket silently left behind.
   *
   * Safe to replay. Every step is a conditional write derived from rows read
   * inside the same transaction, so an aborted attempt leaves nothing behind
   * and a second attempt re-reads the current state.
   */
  private async runMergeTransaction(userId: string, sessionId: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.mergeTransaction(userId, sessionId);
        return;
      } catch (err: unknown) {
        if (attempt >= MERGE_MAX_ATTEMPTS || !isSerializationFailure(err)) throw err;
        this.logger.warn(
          `mergeCart: write conflict on attempt ${attempt}/${MERGE_MAX_ATTEMPTS}, retrying`,
        );
        // A short jittered pause. Retrying into the same instant is how two
        // conflicting transactions keep losing to each other.
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt + Math.random() * 25));
      }
    }
  }

  private async mergeTransaction(userId: string, sessionId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const [userCart, anonCart] = await Promise.all([
          tx.cart.findUnique({
            where: { userId },
            include: { items: true },
          }),
          tx.cart.findUnique({
            where: { sessionId },
            include: { items: true },
          }),
        ]);

        if (!anonCart || !anonCart.items.length) return;

        if (!userCart) {
          // Claim the anonymous cart for this user
          await tx.cart.update({
            where: { id: anonCart.id },
            data: { userId, sessionId: null },
          });
          this.logger.log(`mergeCart: claimed anonCart=${anonCart.id} for userId=${userId}`);
          return;
        }

        // User's existing variants take priority — only add non-conflicting items
        const userVariantIds = new Set(userCart.items.map((i) => i.variantId));
        const itemsToAdd = anonCart.items.filter((i) => !userVariantIds.has(i.variantId));

        if (itemsToAdd.length) {
          await tx.cartItem.createMany({
            data: itemsToAdd.map((item) => ({
              cartId: userCart.id,
              variantId: item.variantId,
              quantity: item.quantity,
              productName: item.productName,
              variantLabel: item.variantLabel,
              productSlug: item.productSlug,
              unitPrice: item.unitPrice,
              compareAtPrice: item.compareAtPrice,
              inStock: item.inStock,
              stockAvailable: item.stockAvailable,
              thumbnailUrl: item.thumbnailUrl,
              weight: item.weight,
            })),
            skipDuplicates: true,
          });
        }

        // Carry the tender and the coupon across when the user's cart has
        // none of its own. Only the items used to move, so a shopper who
        // applied a gift card as a guest and then signed in with an existing
        // basket lost it with no message: not a crash, but "my gift card
        // vanished when I logged in" is a support ticket either way. The
        // user's own code wins when there is one, matching the item rule
        // directly above, and neither code is re-validated here because every
        // read path validates before it shows or spends anything.
        const carried: { giftCardCode?: string; couponCode?: string } = {};
        if (!userCart.giftCardCode && anonCart.giftCardCode) {
          carried.giftCardCode = anonCart.giftCardCode;
        }
        if (!userCart.couponCode && anonCart.couponCode) {
          carried.couponCode = anonCart.couponCode;
        }
        if (Object.keys(carried).length) {
          await tx.cart.update({ where: { id: userCart.id }, data: carried });
        }

        // Soft-delete the anonymous cart
        await tx.cart.update({
          where: { id: anonCart.id },
          data: { deletedAt: new Date() },
        });

        this.logger.log(
          `mergeCart: merged anonCart=${anonCart.id} into userCart=${userCart.id} (${itemsToAdd.length} items added)`,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildWhere(userId?: string, sessionId?: string): Prisma.CartWhereInput {
    if (userId) return { userId };
    if (sessionId) return { sessionId };
    throw new BadRequestException({
      error: {
        code: 'CART_IDENTITY_REQUIRED',
        message: 'Cart identity required (userId or sessionId)',
      },
    });
  }

  private async getOrCreate(userId?: string, sessionId?: string) {
    const where = this.buildWhere(userId, sessionId);
    const existing = await this.prisma.cart.findFirst({ where, select: { id: true } });
    if (existing) return existing;

    return this.prisma.cart.create({
      data: { ...(userId ? { userId } : { sessionId }) },
      select: { id: true },
    });
  }

  private async requireCart(userId?: string, sessionId?: string) {
    const cart = await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      select: { id: true },
    });
    if (!cart)
      throw new NotFoundException({
        error: { code: 'CART_NOT_FOUND', message: 'Cart not found' },
      });
    return cart;
  }

  private async requireCartWithItems(userId?: string, sessionId?: string) {
    const cart = await this.prisma.cart.findFirst({
      where: this.buildWhere(userId, sessionId),
      include: { items: true },
    });
    if (!cart || !cart.items.length) {
      throw new BadRequestException({
        error: { code: 'CART_EMPTY', message: 'Cart is empty' },
      });
    }
    return cart;
  }

  private async requireItem(cartId: string, itemId: string) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });
    if (!item)
      throw new NotFoundException({
        error: {
          code: 'CART_ITEM_NOT_FOUND',
          message: `Cart item "${itemId}" not found`,
        },
      });
    return item;
  }

  private async buildPromoItems(cartId: string): Promise<CartItemDto[]> {
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      include: {
        variant: {
          select: {
            productId: true,
            price: true,
            product: { select: { categories: { take: 1, select: { categoryId: true } } } },
          },
        },
      },
    });

    return items.map((item) => ({
      productId: item.variant.productId,
      categoryId: item.variant.product.categories[0]?.categoryId ?? '',
      quantity: item.quantity,
      unitPrice: toNum(item.variant.price),
    }));
  }

  private async computeSubtotal(cartId: string): Promise<number> {
    const items = await this.prisma.cartItem.findMany({
      where: { cartId },
      select: { quantity: true, variant: { select: { price: true } } },
    });
    return items.reduce((s, i) => s + toNum(i.variant.price) * i.quantity, 0);
  }

  /**
   * Recomputes subtotal + automatic discounts and writes to cart.
   * Pass couponCode=null to clear any stored coupon.
   */
  private async recalculateTotals(
    cartId: string,
    userId?: string,
    couponCode?: string | null | undefined,
  ): Promise<void> {
    const subtotal = await this.computeSubtotal(cartId);
    const promoItems = await this.buildPromoItems(cartId);

    let discountAmount = 0;
    let resolvedCoupon = couponCode;

    if (couponCode === undefined) {
      // Preserve existing coupon
      const cart = await this.prisma.cart.findUnique({
        where: { id: cartId },
        select: { couponCode: true },
      });
      resolvedCoupon = cart?.couponCode ?? null;
    }

    const autoDiscounts = await this.promotions.getApplicableAutomatic(
      subtotal,
      promoItems,
      userId,
    );
    discountAmount = autoDiscounts.reduce((s, d) => s + d.discountAmount, 0);

    if (resolvedCoupon) {
      try {
        const validated = await this.promotions.validateCoupon(
          resolvedCoupon,
          subtotal,
          promoItems,
          userId,
        );
        discountAmount += validated.discountAmount;
      } catch {
        // Coupon no longer valid — clear it
        resolvedCoupon = null;
      }
    }

    await this.prisma.cart.update({
      where: { id: cartId },
      data: {
        subtotal,
        discountAmount,
        total: Math.max(0, subtotal - discountAmount),
        // Both were quoted by `estimateShipping` against the basket as it was.
        // Leaving them behind after the basket changes means `getCart` composes
        // `grandTotalTtc` as `grandTotal + <VAT on a different subtotal>`, so
        // the checkout headline over- or under-quotes the charge.
        //
        // Cleared rather than recomputed: the delivery country is not in scope
        // here, and the storefront re-runs the estimate once the address is
        // entered. Until it does the total reads HT, which is true.
        shippingEstimate: null,
        taxEstimate: null,
        ...(couponCode === null && { couponCode: null }),
        ...(resolvedCoupon !== undefined &&
          couponCode === undefined && { couponCode: resolvedCoupon }),
      },
    });
  }

  private emptyCart(id?: string): CartResponse {
    return {
      id: id ?? '',
      items: [],
      subtotal: 0,
      discounts: [],
      shippingEstimate: null,
      shippingMethodName: null,
      taxEstimate: null,
      freeShippingProgress: null,
      total: 0,
      grandTotal: 0,
      grandTotalTtc: 0,
      itemCount: 0,
      couponCode: null,
      giftCard: null,
      crossSellProductIds: CROSS_SELL_STUB,
    };
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function toNum(value: { toNumber(): number } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'object' ? value.toNumber() : value;
}
