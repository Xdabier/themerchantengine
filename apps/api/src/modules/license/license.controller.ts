import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions, RateLimit } from '@common/decorators';
import { ADMIN_API_ROUTES } from '@admin-routes';
import { LicenseService } from './license.service';
import type { LicenseVerdict } from './license.types';

/** A license file is a small JSON document; anything larger is not one. */
const MAX_LICENSE_BYTES = 16 * 1024;

/**
 * The license verdict for the admin banner and the license settings page
 * (plan E1.5.3, E3.5), and the install route that replaces the file.
 */
@ApiTags('license')
@Controller(ADMIN_API_ROUTES.license.base)
export class LicenseController {
  constructor(private readonly service: LicenseService) {}

  @Get()
  @Permissions('license:view')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'License status, claims and grace window' })
  @ApiResponse({ status: 200, description: 'License verdict' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  get(@Query('fresh') fresh?: string): Promise<LicenseVerdict> {
    // `?fresh=1` re-reads the file, for the settings page after an upload.
    return this.service.current(fresh === '1' || fresh === 'true');
  }

  /**
   * Replaces the installed license file (plan E3.5.4).
   *
   * The uploaded bytes are the only input: the destination is the configured
   * `LICENSE_FILE` path and never anything the caller names, the trust root is
   * the key baked into the build and never anything the caller sends, and the
   * service writes nothing until the signature and the bound domains both
   * check out. A refusal carries the verdict's own reason, because "invalid
   * license" tells an operator nothing about which of the three ways it failed.
   */
  @Post(ADMIN_API_ROUTES.license.install)
  @Permissions('license:manage')
  @RateLimit.Admin()
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // Exact, not defensive: the client appends one part named `file` and
      // nothing else. Without `fields` and `parts` the parser accepts an
      // unbounded number of text fields of up to a megabyte each, all of them
      // read into memory before the handler runs. `parts` is busboy's count of
      // every part including the one for `file` itself, so `1` rejected the
      // single legitimate upload before the handler ever ran; `2` is the
      // smallest limit that admits it while still refusing a second part,
      // field or file, appended alongside it.
      limits: { fileSize: MAX_LICENSE_BYTES, files: 1, fields: 0, parts: 2 },
    }),
  )
  @ApiOperation({ summary: 'Install a signed license file, verified before it is written' })
  @ApiResponse({ status: 200, description: 'The verdict of the newly installed license' })
  @ApiResponse({ status: 400, description: 'The file did not verify, and nothing was written' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async install(@UploadedFile() file?: Express.Multer.File): Promise<LicenseVerdict> {
    if (!file || file.size === 0) {
      throw new BadRequestException({
        error: { code: 'LICENSE_FILE_MISSING', message: 'attach the license file as `file`' },
      });
    }
    return this.service.install(file.buffer.toString('utf8'));
  }
}
