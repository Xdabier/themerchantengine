import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type LocaleSet, type LocaleSource, storeLocales } from '@common/locale';
import { SettingsService } from './settings.service';
import { STORE_CONFIG_UPDATED_EVENT } from './settings.events';

/**
 * Keeps the process-wide locale snapshot (`storeLocales` in the shared lib)
 * equal to the `localization` group of the runtime config (plan E1.3).
 *
 * Loaded once at boot and replaced on every `store-config.updated` event, so
 * the global Translatable interceptor, the mail renderer and the SEO
 * processors all resolve against the set an operator saved a moment ago
 * without a settings read per request. A load that fails keeps the last good
 * snapshot: serving the previous locale set is better than serving none.
 *
 * Inject this where a request scope exists; import `storeLocales` where none
 * does. Both read the same object.
 */
const REFRESH_INTERVAL_MS = 60_000;

@Injectable()
export class StoreLocaleRegistry implements LocaleSource, OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger(StoreLocaleRegistry.name);

  constructor(private readonly settings: SettingsService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    // The event only reaches the process that served the write; a second API
    // instance re-reads on a timer so it is never more than a minute behind.
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @OnEvent(STORE_CONFIG_UPDATED_EVENT, { async: true })
  async onStoreConfigUpdated(): Promise<void> {
    await this.refresh();
  }

  current(): LocaleSet {
    return storeLocales.current();
  }

  isRtl(locale: string): boolean {
    return storeLocales.isRtl(locale);
  }

  direction(locale: string): 'rtl' | 'ltr' {
    return storeLocales.direction(locale);
  }

  /** Reloads the snapshot from the settings; keeps the last good one on failure. */
  async refresh(): Promise<LocaleSet> {
    try {
      const next = await this.settings.getLocaleSet();
      storeLocales.set(next);
    } catch (err) {
      this.logger.warn(`Locale set reload failed, keeping the last one: ${(err as Error).message}`);
    }
    return storeLocales.current();
  }
}
