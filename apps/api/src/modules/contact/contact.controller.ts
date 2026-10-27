import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public, RateLimit } from '@common/decorators';
import { BotProtected } from '../../common/bot-protection';
import { ContactService } from './contact.service';
import { ContactFormDto } from './dto/contact-form.dto';

@Controller('v1')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * Public storefront contact form. No auth (anonymous visitors submit);
   * tightly rate-limited as an anti-spam measure, plus honeypot + (gated)
   * Cloudflare Turnstile via `@BotProtected()` (bot-abuse hardening 2026-06-25).
   */
  @Post('contact')
  @Public()
  @BotProtected()
  @RateLimit.ContactForm()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit a contact-form message' })
  @ApiResponse({ status: 202, description: 'Message received' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  submit(@Body() dto: ContactFormDto) {
    return this.contact.submit(dto);
  }
}
