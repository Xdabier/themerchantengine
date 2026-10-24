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
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import {
  IdempotencyKey,
  IdempotencyKeyPipe,
} from '../../common/decorators/idempotency-key.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto, ListDeliveriesDto, ListWebhooksDto, UpdateWebhookDto } from './dto';

@ApiTags('webhooks')
@Controller(ADMIN_API_ROUTES.webhooks.base)
export class WebhooksAdminController {
  constructor(private readonly service: WebhooksService) {}

  /** Create a new webhook subscription. URL is validated for SSRF. */
  @Post()
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new webhook subscription' })
  create(@Body() dto: CreateWebhookDto) {
    return this.service.createSubscription(dto);
  }

  /** List all webhook subscriptions (secrets omitted). */
  @Get()
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'List webhook subscriptions' })
  list(@Query() dto: ListWebhooksDto) {
    return this.service.listSubscriptions(dto);
  }

  /** Get a single subscription by ID (secret omitted). */
  @Get(ADMIN_API_ROUTES.webhooks.byId)
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Get webhook subscription' })
  get(@Param('id') id: string) {
    return this.service.getSubscription(id);
  }

  /** Update URL, event list, or active status. */
  @Patch(ADMIN_API_ROUTES.webhooks.byId)
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Update webhook subscription' })
  update(@Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.service.updateSubscription(id, dto);
  }

  /** Permanently delete a subscription. */
  @Delete(ADMIN_API_ROUTES.webhooks.byId)
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete webhook subscription' })
  remove(@Param('id') id: string) {
    return this.service.deleteSubscription(id);
  }

  /**
   * Send a test event to verify the endpoint is reachable.
   * Uses the first subscribed event type (or the first in the catalog).
   */
  @Post(ADMIN_API_ROUTES.webhooks.test)
  @Permissions('settings:manage')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'Send a test event to a webhook subscription' })
  test(
    @Param('id') id: string,
    @Req() req: { user: { id: string } },
    @IdempotencyKey(IdempotencyKeyPipe) idempotencyKey: string,
  ) {
    return this.service.sendTestEvent(id, req.user.id, idempotencyKey);
  }

  /** Paginated delivery log for a subscription. */
  @Get(ADMIN_API_ROUTES.webhooks.deliveries)
  @Permissions('settings:view')
  @RateLimit.Admin()
  @ApiOperation({ summary: 'List deliveries for a webhook subscription' })
  deliveries(@Param('id') id: string, @Query() dto: ListDeliveriesDto) {
    return this.service.listDeliveries(id, dto);
  }
}
