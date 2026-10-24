import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { RedirectType } from '@prisma/client';

const PATH_REGEX = /^\/(?!\/|\\)/;

export class CreateRedirectAdminDto {
  /** Source path. Must start with / (rejects // and /\ to block open redirects). */
  @IsString()
  @Matches(PATH_REGEX, { message: 'fromPath must start with / and not // or /\\' })
  fromPath: string;

  /** Destination path. Must start with / (rejects // and /\ to block open redirects). */
  @IsString()
  @Matches(PATH_REGEX, { message: 'toPath must start with / and not // or /\\' })
  toPath: string;

  /** 301 (MOVED_PERMANENTLY) or 302 (FOUND). Defaults to MOVED_PERMANENTLY. */
  @IsOptional()
  @IsEnum(RedirectType)
  type?: RedirectType;
}
