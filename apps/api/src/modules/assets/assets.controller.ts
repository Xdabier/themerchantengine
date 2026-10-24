import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { AssetsService } from './assets.service';
import { ListAssetsDto } from './dto/query-assets.dto';
import { GetAssetReferencesDto } from './dto/query-references.dto';

@ApiTags('assets')
@Controller(ADMIN_API_ROUTES.assets.base)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * Upload a file and immediately receive an asset record.
   * Processing (resize, format conversion, blurhash) happens asynchronously.
   * Poll the returned asset id to check when status becomes READY.
   */
  @Post(ADMIN_API_ROUTES.assets.upload)
  @Permissions('assets:create')
  @RateLimit.AssetUpload()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiOperation({ summary: 'Upload asset file' })
  @ApiResponse({ status: 201, description: 'Asset created' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  uploadAsset(@UploadedFile() file: Express.Multer.File) {
    return this.assetsService.upload(file);
  }

  @Get(ADMIN_API_ROUTES.assets.list)
  @Permissions('assets:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List assets' })
  @ApiResponse({ status: 200, description: 'Assets retrieved' })
  list(@Query() query: ListAssetsDto) {
    return this.assetsService.list(query);
  }

  @Get(ADMIN_API_ROUTES.assets.byId)
  @Permissions('assets:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get asset with usage counts' })
  @ApiResponse({ status: 200, description: 'Asset retrieved' })
  @ApiResponse({ status: 400, description: 'Asset not found' })
  findOne(@Param('id') id: string) {
    return this.assetsService.findOne(id);
  }

  @Get(ADMIN_API_ROUTES.assets.references)
  @Permissions('assets:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List entities that reference this asset' })
  @ApiResponse({ status: 200, description: 'References listed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  getReferences(@Param('id') id: string, @Query() query: GetAssetReferencesDto) {
    return this.assetsService.getReferences(id, query);
  }

  @Get(ADMIN_API_ROUTES.assets.originalUrl)
  @Permissions('assets:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a short-TTL signed URL for the original (asset-variant-serving)',
  })
  @ApiResponse({ status: 200, description: 'Signed URL returned (5-minute TTL)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Asset missing or original deleted' })
  getOriginalUrl(@Param('id') id: string) {
    return this.assetsService.getOriginalUrl(id);
  }

  @Delete(ADMIN_API_ROUTES.assets.byId)
  @Permissions('assets:delete')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete asset (hard delete, refused while referenced)' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 400, description: 'Asset not found' })
  @ApiResponse({ status: 409, description: 'Asset has references' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.assetsService.remove(id);
  }
}
