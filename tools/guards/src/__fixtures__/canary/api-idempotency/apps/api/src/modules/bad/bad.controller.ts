// Canary fixture. Never registered in a Nest module.
import { Body, Controller, Post } from '@nestjs/common';
import { OptionalAuth } from '@common/decorators';

@Controller('v1')
export class BadController {
  @Post('orders')
  @OptionalAuth()
  createOrder(@Body() dto: unknown) {
    return dto;
  }
}
