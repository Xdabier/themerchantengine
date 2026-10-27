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
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { ProductsService } from './products.service';
import { CreateProductAdminDto } from './dto/create-product.dto';
import { UpdateProductAdminDto } from './dto/update-product.dto';
import { CreateProductVariantAdminDto } from './dto/create-variant.dto';
import { UpdateProductVariantAdminDto } from './dto/update-variant.dto';
import { UpdateProductAssetsAdminDto } from './dto/update-assets.dto';
import { CreateProductFaqAdminDto } from './dto/create-faq.dto';
import { UpdateProductFaqAdminDto } from './dto/update-faq.dto';
import { ListSpecLabelsAdminDto, ReplaceProductSpecsAdminDto } from './dto/replace-specs.dto';
import { BulkUpdatePricesAdminDto } from './dto/bulk-prices.dto';
import { BulkUpdateStatusAdminDto } from './dto/bulk-status.dto';
import { CreateProductTypeAdminDto } from './dto/create-product-type.dto';
import { UpdateProductTypeAdminDto } from './dto/update-product-type.dto';
import { CreateAttributeAdminDto } from './dto/create-attribute.dto';
import { UpdateAttributeAdminDto } from './dto/update-attribute.dto';
import { CreateAttributeValueAdminDto } from './dto/create-attribute-value.dto';
import { UpdateAttributeValueAdminDto } from './dto/update-attribute-value.dto';
import { ListProductsAdminDto } from './dto/query-products.dto';

@ApiTags('admin-products')
@Controller(ADMIN_API_ROUTES.products.base)
export class ProductsAdminController {
  constructor(private readonly productsService: ProductsService) {}

  // ── Admin: Product Types ────────────────────────────────────────────────────
  // Declared before /admin/products to avoid route-prefix conflicts.

  /** List all product types with their attributes. */
  @Get(ADMIN_API_ROUTES.products.productTypes)
  @Permissions('products:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all product types' })
  @ApiResponse({ status: 200, description: 'Product types retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listProductTypes(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.productsService.listProductTypes(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }

  /** Create a new product type. */
  @Post(ADMIN_API_ROUTES.products.productTypes)
  @Permissions('products:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new product type' })
  @ApiResponse({ status: 201, description: 'Product type created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createProductType(@Body() dto: CreateProductTypeAdminDto) {
    return this.productsService.createProductType(dto);
  }

  /** Update a product type. */
  @Patch(ADMIN_API_ROUTES.products.productTypeById)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update product type' })
  @ApiResponse({ status: 200, description: 'Product type updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product type not found' })
  updateProductType(@Param('id') id: string, @Body() dto: UpdateProductTypeAdminDto) {
    return this.productsService.updateProductType(id, dto);
  }

  /** Delete a product type (blocked if products are using it). */
  @Delete(ADMIN_API_ROUTES.products.productTypeById)
  @Permissions('products:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete product type' })
  @ApiResponse({ status: 204, description: 'Product type deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product type not found' })
  @ApiResponse({ status: 409, description: 'Product type in use' })
  deleteProductType(@Param('id') id: string) {
    return this.productsService.deleteProductType(id);
  }

  // ── Admin: Attributes ───────────────────────────────────────────────────────

  /** List attributes, optionally filtered by productTypeId. */
  @Get(ADMIN_API_ROUTES.products.attributes)
  @Permissions('products:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List product attributes' })
  @ApiResponse({ status: 200, description: 'Attributes retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listAttributes(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('productTypeId') productTypeId?: string,
  ) {
    return this.productsService.listAttributes(
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : undefined,
      productTypeId,
    );
  }

  /** Create a new attribute (scoped to a product type). */
  @Post(ADMIN_API_ROUTES.products.attributes)
  @Permissions('products:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new attribute' })
  @ApiResponse({ status: 201, description: 'Attribute created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createAttribute(@Body() dto: CreateAttributeAdminDto) {
    return this.productsService.createAttribute(dto);
  }

  /** Update an attribute. productTypeId is immutable. */
  @Patch(ADMIN_API_ROUTES.products.attributeById)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update attribute' })
  @ApiResponse({ status: 200, description: 'Attribute updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Attribute not found' })
  updateAttribute(@Param('id') id: string, @Body() dto: UpdateAttributeAdminDto) {
    return this.productsService.updateAttribute(id, dto);
  }

  /** Delete an attribute (blocked if variants are using its values). */
  @Delete(ADMIN_API_ROUTES.products.attributeById)
  @Permissions('products:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete attribute' })
  @ApiResponse({ status: 204, description: 'Attribute deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Attribute not found' })
  @ApiResponse({ status: 409, description: 'Attribute in use' })
  deleteAttribute(@Param('id') id: string) {
    return this.productsService.deleteAttribute(id);
  }

  /** Add a value to an attribute. */
  @Post(ADMIN_API_ROUTES.products.attributeValues)
  @Permissions('products:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create attribute value' })
  @ApiResponse({ status: 201, description: 'Attribute value created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Attribute not found' })
  createAttributeValue(
    @Param('id') attributeId: string,
    @Body() dto: CreateAttributeValueAdminDto,
  ) {
    return this.productsService.createAttributeValue(attributeId, dto);
  }

  /** Update an attribute value. */
  @Patch(ADMIN_API_ROUTES.products.attributeValueById)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update attribute value' })
  @ApiResponse({ status: 200, description: 'Attribute value updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Value not found' })
  updateAttributeValue(
    @Param('id') attributeId: string,
    @Param('valueId') valueId: string,
    @Body() dto: UpdateAttributeValueAdminDto,
  ) {
    return this.productsService.updateAttributeValue(attributeId, valueId, dto);
  }

  /** Delete an attribute value (blocked if variants are using it). */
  @Delete(ADMIN_API_ROUTES.products.attributeValueById)
  @Permissions('products:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete attribute value' })
  @ApiResponse({ status: 204, description: 'Attribute value deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Value not found' })
  @ApiResponse({ status: 409, description: 'Value in use' })
  deleteAttributeValue(@Param('id') attributeId: string, @Param('valueId') valueId: string) {
    return this.productsService.deleteAttributeValue(attributeId, valueId);
  }

  // ── Admin: Products (bulk before :id to avoid shadowing) ───────────────────

  /**
   * Bulk price update for variants.
   * MUST be declared before PATCH admin/products/:id.
   */
  @Patch(ADMIN_API_ROUTES.products.bulkPrices)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk update variant prices' })
  @ApiResponse({ status: 204, description: 'Prices updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  bulkUpdatePrices(@Body() dto: BulkUpdatePricesAdminDto) {
    return this.productsService.bulkUpdatePrices(dto);
  }

  /**
   * Bulk status change for products.
   * MUST be declared before PATCH admin/products/:id.
   */
  @Patch(ADMIN_API_ROUTES.products.bulkStatus)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bulk update product statuses' })
  @ApiResponse({ status: 204, description: 'Statuses updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  bulkUpdateStatus(@Body() dto: BulkUpdateStatusAdminDto) {
    return this.productsService.bulkUpdateStatus(dto);
  }

  /** Paginated product list (all statuses, includes quality scores). */
  @Get(ADMIN_API_ROUTES.products.list)
  @Permissions('products:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all products (admin)' })
  @ApiResponse({ status: 200, description: 'Products retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  adminListProducts(@Query() query: ListProductsAdminDto) {
    return this.productsService.adminListProducts(query);
  }

  /** Create a product with optional variants, categories, and assets. */
  @Post(ADMIN_API_ROUTES.products.list)
  @Permissions('products:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new product' })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createProduct(@Body() dto: CreateProductAdminDto) {
    return this.productsService.createProduct(dto);
  }

  /** Full admin product detail including quality score and all relations. */
  @Get(ADMIN_API_ROUTES.products.byId)
  @Permissions('products:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get product by ID (admin)' })
  @ApiResponse({ status: 200, description: 'Product retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  adminGetProduct(@Param('id') id: string) {
    return this.productsService.adminGetProduct(id);
  }

  /** Update a product. Category assignments replaced when categoryIds provided. */
  @Patch(ADMIN_API_ROUTES.products.byId)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update product' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductAdminDto) {
    return this.productsService.updateProduct(id, dto);
  }

  /** Soft-delete: sets status=ARCHIVED and deletedAt. */
  @Delete(ADMIN_API_ROUTES.products.byId)
  @Permissions('products:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete product' })
  @ApiResponse({ status: 204, description: 'Product deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  deleteProduct(@Param('id') id: string) {
    return this.productsService.deleteProduct(id);
  }

  /** Restore archived product: clears deletedAt, sets status=DRAFT. */
  @Patch(ADMIN_API_ROUTES.products.restore)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore archived product' })
  @ApiResponse({ status: 200, description: 'Product restored' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  restoreProduct(@Param('id') id: string) {
    return this.productsService.restoreProduct(id);
  }

  // ── Admin: Variants ─────────────────────────────────────────────────────────

  /** Add a variant to a product. */
  @Post(ADMIN_API_ROUTES.products.variants)
  @Permissions('products:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create product variant' })
  @ApiResponse({ status: 201, description: 'Variant created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  createVariant(@Param('id') productId: string, @Body() dto: CreateProductVariantAdminDto) {
    return this.productsService.createVariant(productId, dto);
  }

  /** Update a variant. */
  @Patch(ADMIN_API_ROUTES.products.variantById)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update product variant' })
  @ApiResponse({ status: 200, description: 'Variant updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  updateVariant(
    @Param('id') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateProductVariantAdminDto,
  ) {
    return this.productsService.updateVariant(productId, variantId, dto);
  }

  /** Soft-delete a variant (blocked if it is the last active variant). */
  @Delete(ADMIN_API_ROUTES.products.variantById)
  @Permissions('products:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete product variant' })
  @ApiResponse({ status: 204, description: 'Variant deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Variant not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete last variant' })
  deleteVariant(@Param('id') productId: string, @Param('variantId') variantId: string) {
    return this.productsService.deleteVariant(productId, variantId);
  }

  // ── Admin: Assets ───────────────────────────────────────────────────────────

  /** Replace all asset assignments for a product (reorder + set primary). */
  @Patch(ADMIN_API_ROUTES.products.assets)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update product assets' })
  @ApiResponse({ status: 204, description: 'Assets updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  updateAssets(@Param('id') productId: string, @Body() dto: UpdateProductAssetsAdminDto) {
    return this.productsService.updateAssets(productId, dto);
  }

  // ── Admin: FAQs ─────────────────────────────────────────────────────────────

  /** Add a FAQ entry to a product. */
  @Post(ADMIN_API_ROUTES.products.faqs)
  @Permissions('products:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create product FAQ' })
  @ApiResponse({ status: 201, description: 'FAQ created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  createFaq(@Param('id') productId: string, @Body() dto: CreateProductFaqAdminDto) {
    return this.productsService.createFaq(productId, dto);
  }

  /** Update a FAQ entry. */
  @Patch(ADMIN_API_ROUTES.products.faqById)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update product FAQ' })
  @ApiResponse({ status: 200, description: 'FAQ updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'FAQ not found' })
  updateFaq(
    @Param('id') productId: string,
    @Param('faqId') faqId: string,
    @Body() dto: UpdateProductFaqAdminDto,
  ) {
    return this.productsService.updateFaq(productId, faqId, dto);
  }

  /** Delete a FAQ entry. */
  @Delete(ADMIN_API_ROUTES.products.faqById)
  @Permissions('products:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete product FAQ' })
  @ApiResponse({ status: 204, description: 'FAQ deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'FAQ not found' })
  deleteFaq(@Param('id') productId: string, @Param('faqId') faqId: string) {
    return this.productsService.deleteFaq(productId, faqId);
  }

  // ── Admin: Specifications ───────────────────────────────────────────────────

  /**
   * Distinct spec labels across the catalogue, for the editor's autocomplete.
   *
   * Declared BEFORE the `:id` routes below is not required here because the
   * path's first segment is `product-specs`, which cannot collide with
   * `products/:id`. Kept adjacent to the replace route so the pair reads
   * together.
   */
  @Get(ADMIN_API_ROUTES.products.specLabels)
  @Permissions('products:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List distinct product specification labels' })
  @ApiResponse({ status: 200, description: 'Labels returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  listSpecLabels(@Query() query: ListSpecLabelsAdminDto) {
    return this.productsService.listSpecLabels(query);
  }

  /**
   * Replace a product's specifications.
   *
   * `products:update` alone, never paired with `products:delete` even though
   * this can remove rows: `PermissionsGuard` resolves multiple permissions with
   * `.some(...)`, so a pair would WIDEN the gate to anyone holding either, and
   * there is no AND form. Specs cascade with their product and have no life of
   * their own, so replacing the set is an update to the product.
   */
  @Put(ADMIN_API_ROUTES.products.specs)
  @Permissions('products:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace product specifications' })
  @ApiResponse({ status: 200, description: 'Specifications replaced' })
  @ApiResponse({ status: 400, description: 'Invalid input, duplicate or empty folded key' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  replaceSpecs(@Param('id') productId: string, @Body() dto: ReplaceProductSpecsAdminDto) {
    return this.productsService.replaceSpecs(productId, dto);
  }

  /**
   * Stock for every variant of a product.
   *
   * `inventory:view` as a SINGLE permission, never listed alongside
   * `products:view`: `PermissionsGuard` resolves multiple permissions with
   * `.some(...)`, so a pair would be an OR and would hand stock counts to an
   * operator holding only the products permission.
   */
  @Get(ADMIN_API_ROUTES.products.stock)
  @Permissions('inventory:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stock for every variant of a product' })
  @ApiResponse({ status: 200, description: 'Stock returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  getProductStock(@Param('id') productId: string) {
    return this.productsService.adminGetProductStock(productId);
  }
}
