import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { SettingsService } from './settings.service';
import { UpdateLocalesDto, UpdateSettingsDto } from './dto';

/**
 * Admin settings management endpoints.
 * All routes require JWT + settings permission.
 */
@ApiTags('settings')
@Controller(ADMIN_API_ROUTES.settings.base)
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  /**
   * Retrieve all settings organized by group.
   *
   * Returns: { data: { general: {...}, localization: {...}, ... } }
   */
  @Get()
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get all settings grouped by section' })
  async getAll() {
    return this.service.getAllGrouped();
  }

  /**
   * Update one or more settings.
   *
   * Partial updates only — supply the keys you want to change.
   * All values are validated according to their expected types.
   *
   * Example: PATCH /v1/admin/settings
   * {
   *   "storeName": { "default": "Acme Corp", "en": "Acme Corp" },
   *   "contactEmail": "contact@acme.com",
   *   "supportedLocales": ["fr", "en"],
   *   "guestCheckoutEnabled": false
   * }
   */
  @Patch()
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update one or more settings' })
  async update(@Body() dto: UpdateSettingsDto) {
    await this.service.updateMany(dto);
    return this.service.getAllGrouped();
  }

  /**
   * Get supported locales and default locale.
   *
   * Returns: { data: { supportedLocales: ["fr", "en"], defaultLocale: "fr" } }
   */
  @Get(ADMIN_API_ROUTES.settings.locales)
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get supported locales and default locale' })
  async getLocales() {
    return this.service.getLocales();
  }

  /**
   * Update supported locales and default locale together.
   *
   * Validates that defaultLocale is one of supportedLocales.
   *
   * Example: PATCH /v1/admin/settings/locales
   * {
   *   "supportedLocales": ["fr", "en"],
   *   "defaultLocale": "fr"
   * }
   */
  @Patch(ADMIN_API_ROUTES.settings.locales)
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update supported locales and default locale' })
  async updateLocales(@Body() dto: UpdateLocalesDto) {
    await this.service.updateLocales(dto.supportedLocales, dto.defaultLocale, dto.rtlLocales);
    return this.service.getLocales();
  }
}
