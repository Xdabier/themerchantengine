import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Permissions, Public, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
// Pure functions, no service and no Prisma, so importing them here keeps
// module isolation intact while guaranteeing one URL shape (§3.14).
import { entityPath, resolvePublicBaseUrl } from '../seo/site-url';
import { defaultLocale, supportedLocales } from '../seo/seo.constants';
import { StorefrontConfigService } from './storefront-config.service';
import { PageSlugPipe } from './page-slug.pipe';
import {
  CreateSectionAdminDto,
  ListSectionsAdminDto,
  ReorderSectionsAdminDto,
  ToggleVisibilityAdminDto,
  UpdateSectionAdminDto,
} from './dto';

@ApiTags('storefront-config')
@Controller('v1/storefront')
export class StorefrontConfigStorefrontController {
  private readonly logger = new Logger(StorefrontConfigStorefrontController.name);

  constructor(private readonly service: StorefrontConfigService) {}

  /**
   * @deprecated S21 cutover (DR-04) replaced this endpoint with
   * `GET /v1/storefront/sections/:pageSlug` (operator-managed via
   * `StorefrontSection`). Kept alive for one release window so any
   * out-of-tree client can migrate; the previous storefront client was
   * removed in S21. Returns null banner fields after the S21 cleanup
   * removed the underlying StoreSetting rows. Removed in a follow-up
   * commit one release after S21 ships.
   */
  @Get('home-banners')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({
    summary: 'DEPRECATED: Get homepage hero + mid-banner config',
    description:
      'Deprecated. Use GET /v1/storefront/sections/:pageSlug instead. Every field is null and the route is removed in a later release.',
    deprecated: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Banner config retrieved (every field null on a current store)',
  })
  getHomeBanners() {
    this.logger.warn(
      'GET /v1/storefront/home-banners is deprecated. Migrate to GET /v1/storefront/sections/:pageSlug.',
    );
    return this.service.getHomeBanners();
  }

  /**
   * Everything the storefront has to know about the store before it can render
   * a page: who the store is, what it charges in, which locales it speaks, what
   * counts as low stock and which vendor tags to load.
   *
   * `@Public()` because it is read at SSR boot, before any visitor is known.
   * The payload is an explicit allowlist built in the service, so registering a
   * new admin setting can never publish it by accident.
   */
  @Get('config')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({
    summary: 'Get the public store identity, currency, locales, stock threshold and pixels',
  })
  @ApiResponse({ status: 200, description: 'Storefront config retrieved' })
  getConfig() {
    return this.service.getPublicConfig();
  }

  @Get('sections/:pageSlug')
  @Public()
  @RateLimit.StorefrontRead()
  @ApiOperation({
    summary:
      'Get visible storefront sections for a page (Translatable resolved, asset URLs hydrated)',
  })
  @ApiResponse({ status: 200, description: 'Sections retrieved' })
  @ApiResponse({ status: 400, description: 'Invalid pageSlug' })
  getSections(@Param('pageSlug', PageSlugPipe) pageSlug: string) {
    return this.service.getSections(pageSlug);
  }
}

@ApiTags('storefront-config')
@Controller(ADMIN_API_ROUTES.storefrontConfig.base)
export class StorefrontConfigAdminController {
  constructor(
    private readonly service: StorefrontConfigService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The public storefront origin and the shape of a product URL, so the admin
   * can link an operator straight to the page a customer sees.
   *
   * Gated on `products:view` rather than `storefront_config:view`. Every
   * operator who can open a product should be able to click through to it, and
   * the seeded Support role holds `products:view` but neither
   * `storefront_config:view` nor `settings:view`. It is deliberately NOT
   * permission-free: constitution §3.3 makes a missing decorator on an admin
   * route a CI-blocking lint violation, and DR-26 states in terms that it
   * "licenses exactly one route" and "is not a precedent for omitting
   * @Permissions elsewhere".
   *
   * `productPathTemplate` is DERIVED from `entityPath` rather than written as a
   * literal, so this response cannot drift from the shape the sitemap, the
   * canonical tag, the JSON-LD and the manual reindex all emit.
   */
  @Get(ADMIN_API_ROUTES.storefrontConfig.publicConfig)
  @Permissions('products:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Public storefront origin and product URL shape' })
  @ApiResponse({ status: 200, description: 'Config returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getPublicConfig() {
    // Unwrapped: the global response interceptor adds the `{ data: ... }`
    // envelope, and wrapping here too emits `{"data":{"data":…}}`.
    return {
      baseUrl: resolvePublicBaseUrl(this.config),
      locales: [...supportedLocales()],
      defaultLocale: defaultLocale(),
      productPathTemplate: entityPath('product', '{slug}', '{locale}'),
    };
  }

  @Get(ADMIN_API_ROUTES.storefrontConfig.pages)
  @Permissions('storefront_config:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get storefront pages' })
  @ApiResponse({ status: 200, description: 'Pages retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getPages() {
    return this.service.getPages();
  }

  @Get(ADMIN_API_ROUTES.storefrontConfig.pageSections)
  @Permissions('storefront_config:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get page sections (admin)' })
  @ApiResponse({ status: 200, description: 'Sections retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  adminGetSections(@Param('pageSlug') pageSlug: string, @Query() dto: ListSectionsAdminDto) {
    return this.service.adminGetSections(pageSlug, dto.page, dto.pageSize);
  }

  @Patch(ADMIN_API_ROUTES.storefrontConfig.sectionsReorder)
  @Permissions('storefront_config:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reorder sections' })
  @ApiResponse({ status: 204, description: 'Sections reordered' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  reorderSections(@Param('pageSlug') pageSlug: string, @Body() dto: ReorderSectionsAdminDto) {
    return this.service.reorderSections(pageSlug, dto);
  }

  @Post(ADMIN_API_ROUTES.storefrontConfig.pageSections)
  @Permissions('storefront_config:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create section' })
  @ApiResponse({ status: 201, description: 'Section created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  createSection(@Param('pageSlug') pageSlug: string, @Body() dto: CreateSectionAdminDto) {
    return this.service.createSection({ ...dto, pageSlug });
  }

  @Patch(ADMIN_API_ROUTES.storefrontConfig.sectionById)
  @Permissions('storefront_config:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update section' })
  @ApiResponse({ status: 200, description: 'Section updated' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  updateSection(@Param('id') id: string, @Body() dto: UpdateSectionAdminDto) {
    return this.service.updateSection(id, dto);
  }

  @Delete(ADMIN_API_ROUTES.storefrontConfig.sectionById)
  @Permissions('storefront_config:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete section' })
  @ApiResponse({ status: 204, description: 'Section deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  deleteSection(@Param('id') id: string) {
    return this.service.deleteSection(id);
  }

  @Patch(ADMIN_API_ROUTES.storefrontConfig.sectionVisibility)
  @Permissions('storefront_config:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle section visibility' })
  @ApiResponse({ status: 200, description: 'Visibility toggled' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Section not found' })
  toggleVisibility(@Param('id') id: string, @Body() dto: ToggleVisibilityAdminDto) {
    return this.service.toggleVisibility(id, dto);
  }
}
