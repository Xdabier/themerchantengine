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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { CampaignService } from './campaign.service';
import { resolveLocale } from '../mail/listeners/locale.util';
import {
  CreateCampaignDto,
  ListCampaignsDto,
  PreviewCampaignDto,
  SendTestCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

interface AuthenticatedRequest extends Request {
  user: { id: string; role: string; permissions: string[] };
}

@ApiTags('campaigns-admin')
@Controller(ADMIN_API_ROUTES.campaigns.base)
export class CampaignsController {
  constructor(private readonly service: CampaignService) {}

  @Get()
  @Permissions('campaigns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List marketing campaigns' })
  @ApiResponse({ status: 200, description: 'Campaigns retrieved' })
  list(@Query() query: ListCampaignsDto) {
    return this.service.list(query);
  }

  @Get(ADMIN_API_ROUTES.campaigns.byId)
  @Permissions('campaigns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a campaign' })
  @ApiResponse({ status: 200, description: 'Campaign retrieved' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(ADMIN_API_ROUTES.campaigns.stats)
  @Permissions('campaigns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Per-status send counts for a campaign' })
  @ApiResponse({ status: 200, description: 'Stats retrieved' })
  stats(@Param('id') id: string) {
    return this.service.stats(id);
  }

  @Post()
  @Permissions('campaigns:create')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a marketing campaign' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid input / invalid coupon' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCampaignDto) {
    return this.service.create(dto, req.user.id);
  }

  @Patch(ADMIN_API_ROUTES.campaigns.byId)
  @Permissions('campaigns:update')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a draft / scheduled campaign' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Invalid input / invalid coupon' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  @ApiResponse({ status: 409, description: 'Campaign is not editable' })
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.service.update(id, dto);
  }

  @Post(ADMIN_API_ROUTES.campaigns.preview)
  @Permissions('campaigns:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Render a draft campaign for every enabled locale (no send, no persist)',
  })
  @ApiResponse({ status: 200, description: 'Rendered preview' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  preview(@Param('id') id: string, @Body() dto: PreviewCampaignDto) {
    return this.service.preview(id, dto);
  }

  @Post(ADMIN_API_ROUTES.campaigns.send)
  @Permissions('campaigns:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send / start a campaign on the isolated campaign queue' })
  @ApiResponse({ status: 200, description: 'Sending started' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  @ApiResponse({ status: 409, description: 'Campaign is not sendable' })
  send(@Param('id') id: string) {
    return this.service.send(id);
  }

  @Post(ADMIN_API_ROUTES.campaigns.test)
  @Permissions('campaigns:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test of this campaign to your own inbox' })
  @ApiResponse({ status: 200, description: 'Test sent' })
  @ApiResponse({ status: 400, description: 'No recipient email on file' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  sendTest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: SendTestCampaignDto,
  ) {
    return this.service.sendTest(id, req.user.id, resolveLocale(dto.locale));
  }

  @Delete(ADMIN_API_ROUTES.campaigns.byId)
  @Permissions('campaigns:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a campaign' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Campaign not found' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.service.remove(id);
  }
}
