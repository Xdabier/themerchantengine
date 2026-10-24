import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, Public, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { GiftCardsService } from './gift-cards.service';
import { CheckBalanceDto } from './dto/check-balance.dto';
import { CreateGiftCardAdminDto } from './dto/create-gift-card.dto';
import { UpdateGiftCardAdminDto } from './dto/update-gift-card.dto';
import { ListGiftCardsAdminDto } from './dto/query-gift-card.dto';
import { AdjustGiftCardBalanceDto } from './dto/adjust-balance.dto';

@ApiTags('gift-cards')
@Controller(ADMIN_API_ROUTES.giftCards.base)
export class GiftCardsController {
  constructor(private readonly giftCardsService: GiftCardsService) {}

  // ── Storefront ─────────────────────────────────────────────────────────────

  /**
   * Returns the current balance for a gift card code.
   * Rate limited to 10 req/min per IP to prevent brute-force enumeration (spec §8.1 API6).
   * Always returns a generic error on invalid/expired codes.
   */
  @Get('gift-cards/balance')
  @Public()
  @RateLimit.GiftCardLookup()
  @ApiOperation({ summary: 'Check gift card balance' })
  @ApiResponse({ status: 200, description: 'Balance retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid gift card' })
  checkBalance(@Query() query: CheckBalanceDto) {
    return this.giftCardsService.checkBalance(query.code);
  }

  /**
   * There is deliberately no customer-facing purchase route.
   *
   * `POST /v1/gift-cards/purchase` used to mint a card of any value for any
   * signed-in customer, with no payment, no order and no payment reference:
   * the handler read `initialBalance` straight off the request body and wrote
   * it to `currentBalance`. It had no caller in the storefront, so the only
   * way to reach it was to call the API directly, and the storefront's
   * gift-card apply being broken end to end was the only thing making the
   * minted balance awkward to spend.
   *
   * Removed rather than gated, because a gate is a thing someone can turn
   * back on. Issuing gift cards stays an admin action behind
   * `gift_cards:manage`; a customer-facing purchase flow needs a captured
   * payment first. Recorded as DR-30.
   */

  // ── Admin ──────────────────────────────────────────────────────────────────

  /** Paginated list of all gift cards with optional filters. */
  @Get(ADMIN_API_ROUTES.giftCards.adminList)
  @Permissions('gift_cards:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List gift cards' })
  @ApiResponse({ status: 200, description: 'Gift cards retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  list(@Query() query: ListGiftCardsAdminDto) {
    return this.giftCardsService.list(query);
  }

  /** Issue a gift card or store credit (purchasedBy omitted = store credit). */
  @Post(ADMIN_API_ROUTES.giftCards.adminList)
  @Permissions('gift_cards:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Issue gift card' })
  @ApiResponse({ status: 201, description: 'Gift card issued' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  issue(@Body() dto: CreateGiftCardAdminDto) {
    return this.giftCardsService.issue(dto);
  }

  /** Gift card detail view including full immutable transaction log. */
  @Get(ADMIN_API_ROUTES.giftCards.adminById)
  @Permissions('gift_cards:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get gift card by ID' })
  @ApiResponse({ status: 200, description: 'Gift card retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Gift card not found' })
  findOne(@Param('id') id: string) {
    return this.giftCardsService.findOne(id);
  }

  /** Activate or deactivate a gift card. */
  @Patch(ADMIN_API_ROUTES.giftCards.adminById)
  @Permissions('gift_cards:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update gift card' })
  @ApiResponse({ status: 200, description: 'Gift card updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Gift card not found' })
  update(@Param('id') id: string, @Body() dto: UpdateGiftCardAdminDto) {
    return this.giftCardsService.update(id, dto);
  }

  /** Adjust a gift card balance. Positive amount = credit, negative = debit. */
  @Post(ADMIN_API_ROUTES.giftCards.adjust)
  @Permissions('gift_cards:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Adjust gift card balance' })
  @ApiResponse({ status: 200, description: 'Balance adjusted' })
  @ApiResponse({ status: 400, description: 'Invalid input (zero delta, overdraw, inactive)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Gift card not found' })
  adjustBalance(@Param('id') id: string, @Body() dto: AdjustGiftCardBalanceDto) {
    return this.giftCardsService.adjustBalance(id, dto);
  }

  /** Re-trigger the redemption email for an active card with a recipient. */
  @Post(ADMIN_API_ROUTES.giftCards.resend)
  @Permissions('gift_cards:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend gift card email' })
  @ApiResponse({ status: 200, description: 'Email queued' })
  @ApiResponse({ status: 400, description: 'No recipient on file / card inactive' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Gift card not found' })
  resendEmail(@Param('id') id: string) {
    return this.giftCardsService.resendEmail(id);
  }
}
