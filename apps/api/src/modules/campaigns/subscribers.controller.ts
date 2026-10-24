import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { SubscriberService } from './subscriber.service';
import { ListSubscribersDto, UpdateSubscriberDto } from './dto/subscriber.dto';

@ApiTags('subscribers-admin')
@Controller(ADMIN_API_ROUTES.subscribers.base)
export class SubscribersController {
  constructor(private readonly service: SubscriberService) {}

  @Get()
  @Permissions('campaigns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List newsletter subscribers' })
  @ApiResponse({ status: 200, description: 'Subscribers retrieved' })
  list(@Query() query: ListSubscribersDto) {
    return this.service.list(query);
  }

  @Patch(ADMIN_API_ROUTES.subscribers.byId)
  @Permissions('campaigns:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Manually unsubscribe / re-activate a subscriber' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 404, description: 'Subscriber not found' })
  update(@Param('id') id: string, @Body() dto: UpdateSubscriberDto) {
    return this.service.setUnsubscribed(id, dto.unsubscribed);
  }
}
