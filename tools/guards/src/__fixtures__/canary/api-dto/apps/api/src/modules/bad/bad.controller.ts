// Canary fixture. Never registered in a Nest module.
import { Body, Controller, Patch, Post } from '@nestjs/common';
import { OptionalAuth, Permissions } from '@common/decorators';

import { NoValidatorDto, SharedWidgetDto } from './dto/shared.dto';

@Controller('v1')
export class BadController {
  @Post('admin/widgets')
  @Permissions('products:create')
  createAdmin(@Body() dto: SharedWidgetDto) {
    return dto;
  }

  @Post('widgets')
  @OptionalAuth()
  createPublic(@Body() dto: SharedWidgetDto) {
    return dto;
  }

  @Post('widgets/loose')
  @OptionalAuth()
  loose(@Body() dto: any) {
    return dto;
  }

  @Post('widgets/plain')
  @OptionalAuth()
  plain(@Body() dto: NoValidatorDto) {
    return dto;
  }

  @Patch('widgets/plucked')
  @OptionalAuth()
  plucked(@Body('name') name: string) {
    return name;
  }
}
