// Canary fixture. Never registered in a Nest module.
import { Controller, Get, Post } from '@nestjs/common';
import { Permissions } from '@common/decorators';

@Controller('v1')
export class BadController {
  @Get('admin/widgets')
  listWidgets() {
    return [];
  }

  @Post('admin/widgets')
  @Permissions('not_a_real_module:create')
  createWidget() {
    return {};
  }

  @Post('storefront/widgets/:id/claim')
  claimWidget() {
    return {};
  }
}
