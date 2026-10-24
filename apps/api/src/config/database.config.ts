import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isTest } from '@common/env';

@Injectable()
export class DatabaseConfig {
  constructor(private configService: ConfigService) {}

  get databaseUrl(): string {
    if (isTest(this.configService)) {
      return this.configService.get<string>(
        'DATABASE_TEST_URL',
        'postgresql://postgres:postgres@localhost:55433/merchants_engine_test',
      );
    }
    return this.configService.get<string>(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:55432/merchants_engine_dev',
    );
  }
}
