import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { randomBytes } from 'node:crypto';
import { isProduction } from '@common/env';
import type { Request, Response } from 'express';
import { OptionalAuth, OwnerGuard, RequireAuth, RateLimit } from '@common/decorators';
import { resolveRequestLocale } from '@common/interceptors';
import { CartService } from './cart.service';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ApplyCouponDto } from './dto/apply-coupon.dto';
import { ApplyGiftCardDto } from './dto/apply-gift-card.dto';
import { EstimateShippingDto } from './dto/estimate-shipping.dto';
import { SESSION_COOKIE_NAME, ANON_CART_EXPIRY_DAYS } from './cart.constants';

// ── Typed request shape ───────────────────────────────────────────────────────

type AuthedRequest = Request & { user?: { id: string } };

@ApiTags('cart')
@Controller('v1/cart')
@OptionalAuth()
export class CartController {
  constructor(private readonly cartService: CartService) {}

  // ── GET /v1/cart ──────────────────────────────────────────────────────────

  @Get()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get shopping cart' })
  @ApiResponse({ status: 200, description: 'Cart retrieved' })
  getCart(@Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.getCart(userId, sessionId);
  }

  // ── POST /v1/cart/items ───────────────────────────────────────────────────

  @Post('items')
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiResponse({ status: 200, description: 'Item added' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  async addItem(
    @Body() dto: AddItemDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, sessionId } = this.identity(req);
    // The storefront states its locale on X-Locale, not Accept-Language, so the
    // snapshot uses the same resolver the response interceptor does.
    const result = await this.cartService.addItem(
      dto,
      userId,
      sessionId,
      resolveRequestLocale(req),
    );
    // Persist the session cookie for anonymous carts
    if (!userId && sessionId) {
      this.setSessionCookie(res, sessionId);
    }
    return result;
  }

  // ── PATCH /v1/cart/items/:itemId ──────────────────────────────────────────

  @Patch('items/:itemId')
  @RateLimit.StorefrontWrite()
  @ApiOperation({ summary: 'Update cart item' })
  @ApiResponse({ status: 200, description: 'Item updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
    @Req() req: AuthedRequest,
  ) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.updateItem(itemId, dto, userId, sessionId);
  }

  // ── DELETE /v1/cart/items/:itemId ─────────────────────────────────────────

  @Delete('items/:itemId')
  @RateLimit.StorefrontWrite()
  @ApiOperation({ summary: 'Remove cart item' })
  @ApiResponse({ status: 200, description: 'Item removed' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  removeItem(@Param('itemId') itemId: string, @Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.removeItem(itemId, userId, sessionId);
  }

  // ── DELETE /v1/cart ───────────────────────────────────────────────────────

  @Delete()
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear shopping cart' })
  @ApiResponse({ status: 204, description: 'Cart cleared' })
  clearCart(@Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.clearCart(userId, sessionId);
  }

  // ── POST /v1/cart/coupon ──────────────────────────────────────────────────

  @Post('coupon')
  @RateLimit.CouponValidation()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply coupon code' })
  @ApiResponse({ status: 200, description: 'Coupon applied' })
  @ApiResponse({ status: 400, description: 'Invalid coupon' })
  applyCoupon(@Body() dto: ApplyCouponDto, @Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.applyCoupon(dto.code, userId, sessionId);
  }

  // ── DELETE /v1/cart/coupon ────────────────────────────────────────────────

  @Delete('coupon')
  @RateLimit.StorefrontWrite()
  @ApiOperation({ summary: 'Remove coupon from cart' })
  @ApiResponse({ status: 200, description: 'Coupon removed' })
  removeCoupon(@Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.removeCoupon(userId, sessionId);
  }

  // ── POST /v1/cart/gift-card ───────────────────────────────────────────────

  @Post('gift-card')
  @RateLimit.GiftCardLookup()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply gift card' })
  @ApiResponse({ status: 200, description: 'Gift card applied; returns the updated cart' })
  @ApiResponse({ status: 400, description: 'Invalid gift card' })
  applyGiftCard(@Body() dto: ApplyGiftCardDto, @Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.applyGiftCard(dto.code, userId, sessionId);
  }

  // ── DELETE /v1/cart/gift-card ─────────────────────────────────────────────

  @Delete('gift-card')
  @RateLimit.StorefrontWrite()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove gift card from cart' })
  @ApiResponse({ status: 204, description: 'Gift card removed' })
  removeGiftCard(@Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.removeGiftCard(userId, sessionId);
  }

  // ── GET /v1/cart/estimate ─────────────────────────────────────────────────

  @Get('estimate')
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Estimate shipping cost' })
  @ApiResponse({ status: 200, description: 'Shipping estimate retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  estimateShipping(@Query() dto: EstimateShippingDto, @Req() req: AuthedRequest) {
    const { userId, sessionId } = this.identity(req);
    return this.cartService.estimateShipping(dto, userId, sessionId);
  }

  // ── POST /v1/cart/items/:itemId/save-for-later ────────────────────────────

  @Post('items/:itemId/save-for-later')
  @RequireAuth()
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save item for later' })
  @ApiResponse({ status: 200, description: 'Item saved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  saveForLater(@Param('itemId') itemId: string, @Req() req: AuthedRequest) {
    return this.cartService.saveForLater(itemId, req.user!.id);
  }

  // ── POST /v1/cart/merge ───────────────────────────────────────────────────

  /**
   * Fold the anonymous cart behind the `sessionId` cookie into the signed-in
   * customer's cart.
   *
   * `CartService.mergeAnonymousCart` has existed and been unit-tested since the
   * cart module was written, but the Better Auth cutover deleted the custom
   * login controller that was its only caller and nothing re-wired it. Since
   * then, signing in has silently dropped the guest basket and its coupon
   * (findings K4 and A9).
   *
   * It has to be a server-side endpoint rather than a client call carrying the
   * session id: the anonymous cart cookie is `HttpOnly`, so browser JS cannot
   * read it. A Better Auth server hook was the alternative, but that instance
   * is a module-level singleton outside Nest DI and cannot inject this service.
   *
   * Cheap to call on every sign-in: the service early-returns when the
   * anonymous cart is missing or empty, and the handler skips it entirely when
   * there is no cookie at all.
   */
  @Post('merge')
  @RequireAuth()
  @OwnerGuard()
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Merge the anonymous cart into the signed-in cart' })
  @ApiResponse({ status: 200, description: 'Merged cart returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async mergeCart(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    const userId = req.user!.id;
    // Deliberately NOT `identity()`: that helper mints a fresh session id when
    // the cookie is absent, which is correct for a cart read and wrong here.
    // Merging against an invented id would open a serializable transaction on
    // every sign-in to find nothing.
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const sessionId = cookies?.[SESSION_COOKIE_NAME];

    if (sessionId) {
      await this.cartService.mergeAnonymousCart(userId, sessionId);
      // The anonymous cart is claimed or soft-deleted by now, so the cookie
      // points at nothing. Leaving it would have the next anonymous read mint
      // a cart against a dead session id.
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    }

    // Answer with the merged cart so the client updates its badge without a
    // second round trip.
    return this.cartService.getCart(userId, undefined);
  }

  // ── Private: identity resolution ─────────────────────────────────────────

  private identity(req: AuthedRequest): { userId?: string; sessionId?: string } {
    if (req.user?.id) return { userId: req.user.id };

    // Extract session id from cookie
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
    const sessionId: string | undefined = cookies?.[SESSION_COOKIE_NAME];

    return { sessionId: sessionId ?? this.newSessionId() };
  }

  /**
   * Mint an anonymous cart session id.
   *
   * This value is a bearer credential, not a correlation id. Since plan F it is
   * the only key to a guest's placed order: whoever holds it can read that
   * order's shipping address, phone, email, line items and totals.
   *
   * It used to be `sess_${Date.now()}_${Math.random()...}`, which was
   * defensible when the worst case was a stranger seeing a cart, and is not
   * defensible now. `Math.random()` is xorshift128+, whose internal state is
   * recoverable from a handful of outputs, and outputs are free to collect:
   * every anonymous add-to-cart hands one back to an unauthenticated caller.
   * `HttpOnly` does not help, because it stops JavaScript reading the cookie,
   * not an attacker sending one.
   */
  private newSessionId(): string {
    return randomBytes(32).toString('base64url');
  }

  private setSessionCookie(res: Response, sessionId: string): void {
    res.cookie(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: 'strict',
      maxAge: ANON_CART_EXPIRY_DAYS * 24 * 60 * 60 * 1_000,
      path: '/',
    });
  }
}
