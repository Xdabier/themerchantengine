import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { OwnerGuard, RateLimit } from '@common/decorators';
import { WishlistService } from './wishlist.service';
import { ListWishlistDto } from './dto/list-wishlist.dto';

type AuthedRequest = { user: { id: string } };

@ApiTags('wishlist')
@Controller('v1')
@OwnerGuard()
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  // ── GET /v1/wishlist ─────────────────────────────────────────────────────

  @Get('wishlist')
  @RateLimit.StorefrontRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get wishlist' })
  @ApiResponse({ status: 200, description: 'Wishlist retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  list(@Req() req: AuthedRequest, @Query() query: ListWishlistDto) {
    return this.wishlist.list(req.user.id, query);
  }

  // ── GET /v1/wishlist/ids ─────────────────────────────────────────────────

  // Declared before the `:productId` routes below so the literal segment is
  // matched first. There is no `GET wishlist/:productId` to shadow today; this
  // keeps that true if one is ever added.
  @Get('wishlist/ids')
  @RateLimit.StorefrontRead()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get wishlisted product ids' })
  @ApiResponse({ status: 200, description: 'Product ids retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listIds(@Req() req: AuthedRequest) {
    return this.wishlist.listIds(req.user.id);
  }

  // ── POST /v1/wishlist/:productId ─────────────────────────────────────────

  @Post('wishlist/:productId')
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add item to wishlist' })
  @ApiResponse({ status: 201, description: 'Item added' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Item already in wishlist' })
  addItem(@Param('productId') productId: string, @Req() req: AuthedRequest) {
    return this.wishlist.addItem(req.user.id, productId);
  }

  // ── DELETE /v1/wishlist/:productId ───────────────────────────────────────

  @Delete('wishlist/:productId')
  @RateLimit.StorefrontWrite()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove item from wishlist' })
  @ApiResponse({ status: 204, description: 'Item removed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  removeItem(@Param('productId') productId: string, @Req() req: AuthedRequest) {
    return this.wishlist.removeItem(req.user.id, productId);
  }
}
