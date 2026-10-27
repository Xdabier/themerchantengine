import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public, RateLimit } from '@common/decorators';
import { resolveRequestLocale } from '@common/interceptors';
import { ProductsService } from './products.service';
import { ListBrandFacetsDto, ListProductsStorefrontDto } from './dto/query-products.dto';

@ApiTags('products')
@Controller('v1')
export class ProductsStorefrontController {
  constructor(private readonly productsService: ProductsService) {}

  /** Paginated product listing. status=ACTIVE only, filterable by category/price/brand/tags. */
  @Get('products')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'List active products' })
  @ApiResponse({ status: 200, description: 'Products retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  listProducts(@Query() query: ListProductsStorefrontDto, @Req() req: Request) {
    // The "Name: A to Z" sort orders on the string the customer reads, so the
    // service needs the same locale the response interceptor will resolve with.
    return this.productsService.listProducts(query, resolveRequestLocale(req));
  }

  /**
   * Filterable specification facets for the catalogue rail.
   *
   * Registered BEFORE `products/:slug`, or Nest matches "spec-facets" as a slug
   * and answers 404 for the facet request.
   */
  @Get('products/spec-facets')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'List filterable specification facets' })
  @ApiResponse({ status: 200, description: 'Facets retrieved' })
  listSpecFacets() {
    return this.productsService.listSpecFacets();
  }

  /**
   * Brand facets for the catalogue rail, over the whole ACTIVE catalogue and
   * optionally scoped to a category.
   *
   * Registered BEFORE `products/:slug` for the same reason spec-facets is.
   */
  @Get('products/brands')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'List brand facets for the catalogue' })
  @ApiResponse({ status: 200, description: 'Brand facets retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  listBrandFacets(@Query() query: ListBrandFacetsDto) {
    return this.productsService.listBrandFacets(query.categoryId);
  }

  /** Full product detail by slug (variants, assets, FAQs, rating summary stub field). */
  @Get('products/:slug')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get product by slug' })
  @ApiResponse({ status: 200, description: 'Product retrieved' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getProductBySlug(@Param('slug') slug: string) {
    return this.productsService.getProductBySlug(slug);
  }
}
