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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, Public, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { CategoriesService } from './categories.service';
import { CreateCategoryAdminDto } from './dto/create-category.dto';
import { UpdateCategoryAdminDto } from './dto/update-category.dto';
import { ReorderCategoriesAdminDto } from './dto/reorder-categories.dto';

@ApiTags('categories')
@Controller(ADMIN_API_ROUTES.categories.base)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // ── Storefront ──────────────────────────────────────────────────────────────

  /** Full visible category tree, cached 1 hour. */
  @Get('categories')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get category tree' })
  @ApiResponse({ status: 200, description: 'Category tree retrieved' })
  getTree() {
    return this.categoriesService.getTree();
  }

  /** Category detail + product count by slug. */
  @Get('categories/:slug')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get category by slug' })
  @ApiResponse({ status: 200, description: 'Category retrieved' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  getBySlug(@Param('slug') slug: string) {
    return this.categoriesService.getBySlug(slug);
  }

  /** Paginated products belonging to a category. */
  @Get('categories/:slug/products')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({ summary: 'Get products in category' })
  @ApiResponse({ status: 200, description: 'Products retrieved' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  getProductsInCategory(
    @Param('slug') slug: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.categoriesService.getProductsInCategory(
      slug,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }

  // ── Admin ───────────────────────────────────────────────────────────────────

  /** Full category tree including hidden categories, with product counts. */
  @Get(ADMIN_API_ROUTES.categories.adminList)
  @Permissions('categories:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get category tree (admin)' })
  @ApiResponse({ status: 200, description: 'Category tree retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  adminGetTree() {
    return this.categoriesService.adminGetTree();
  }

  /** Create a new category. */
  @Post(ADMIN_API_ROUTES.categories.adminList)
  @Permissions('categories:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  create(@Body() dto: CreateCategoryAdminDto) {
    return this.categoriesService.create(dto);
  }

  /**
   * Reorder sibling categories within a parent.
   * Must be declared BEFORE :id to avoid route shadowing.
   */
  @Patch(ADMIN_API_ROUTES.categories.reorder)
  @Permissions('categories:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder categories' })
  @ApiResponse({ status: 204, description: 'Categories reordered' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  reorder(@Body() dto: ReorderCategoriesAdminDto) {
    return this.categoriesService.reorder(dto);
  }

  /** Update a category. If parentId changes, validates circular ref and recomputes paths. */
  @Patch(ADMIN_API_ROUTES.categories.adminById)
  @Permissions('categories:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update category' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryAdminDto) {
    return this.categoriesService.update(id, dto);
  }

  /** Soft-delete a category. Blocked if products are assigned. */
  @Delete(ADMIN_API_ROUTES.categories.adminById)
  @Permissions('categories:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete category' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Category has products' })
  delete(@Param('id') id: string) {
    return this.categoriesService.delete(id);
  }
}
