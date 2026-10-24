// Canary fixture. Never registered in a Nest module.
import { Controller, Get, Header } from '@nestjs/common';

@Controller('v1')
export class BadController {
  @Get('widgets')
  @Header('Cache-Control', 'public, max-age=3600')
  list() {
    return [];
  }
}
