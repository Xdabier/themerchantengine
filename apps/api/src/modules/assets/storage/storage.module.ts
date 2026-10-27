import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { STORAGE_DRIVER } from '../assets.constants';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import type { StorageDriver } from './storage-driver.interface';

/**
 * Shared storage-driver provider. Factored out of `AssetsModule` so any module
 * that needs to persist + sign private objects (assets, orders/invoice PDFs)
 * can `imports: [StorageModule]` and `@Inject(STORAGE_DRIVER)` the single
 * driver instance, instead of each module spinning up its own S3 client.
 *
 * Driver selection mirrors the original `AssetsModule` factory: `STORAGE_DRIVER=s3`
 * → `S3StorageDriver` (production), anything else → `LocalStorageDriver` (dev/e2e).
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriver => {
        const driver = (config.get<string>('STORAGE_DRIVER') ?? 'local').toLowerCase();
        return driver === 's3' ? new S3StorageDriver(config) : new LocalStorageDriver(config);
      },
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
