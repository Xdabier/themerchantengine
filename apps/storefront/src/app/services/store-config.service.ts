import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import {
  Injectable,
  Injector,
  PLATFORM_ID,
  TransferState,
  computed,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';

import { StoreConfigApiService, StoreRuntimeConfigApiService } from '@storefront-services';
import {
  NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
  storefrontConfigSchema,
  storefrontRuntimeConfigSchema,
  type StorefrontConfig,
  type StorefrontRuntimeConfig,
} from '@storefront-types';

/**
 * What the admin configured about this store, held once for the whole app.
 *
 * Every surface that needs the store currency, the contact details, the social
 * profiles, the low-stock threshold or a vendor pixel id reads it here. Before
 * this existed all five were baked into the bundle, so five admin screens
 * round-tripped their values into a void (findings D2, D4, D5, D6, D7).
 *
 * Loaded on the server pass and carried to the browser through `TransferState`,
 * not fetched at hydration: the SSR HTML has to carry the configured identity
 * for a crawler and for a reader on a slow connection, and a browser-only fetch
 * would repaint the footer and the title after paint.
 *
 * **Atomic or nothing** (§3.15-C in spirit). A parse or fetch failure leaves
 * every signal on its baked default and the storefront renders exactly as it
 * did before this service. Nothing here logs at error level: the console
 * baseline fails a journey on any `console.error`, and more importantly a
 * marketing-config endpoint must never be able to take the storefront down.
 */

export const STORE_CONFIG_STATE_KEY = makeStateKey<StorefrontConfig>('storefront-config');

/**
 * The runtime config travels under its own key. Two keys rather than one
 * because the two endpoints answer independently: a failure on either must
 * leave the other's values standing rather than blanking the whole store.
 */
export const STORE_RUNTIME_CONFIG_STATE_KEY =
  makeStateKey<StorefrontRuntimeConfig>('store-runtime-config');

/** A configured social profile, in a stable order the footer can render. */
export interface StoreSocialLink {
  platform: string;
  url: string;
}

/**
 * The threshold used until the API answers. It matches `STORE_CONFIG.inventory
 * .defaultLowStockThreshold` on the API, which is the value an unconfigured
 * store actually grades against, rather than the higher constant the API only
 * reaches when the row is unreadable.
 */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

const NO_PIXELS = {
  googleAnalyticsId: null,
  metaPixelId: null,
  tiktokPixelId: null,
  snapPixelId: null,
} as const;

@Injectable({ providedIn: 'root' })
export class StoreConfigService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);
  /**
   * Resolved at load time, not at construction.
   *
   * Every money surface in the storefront injects this service, so injecting
   * the API client eagerly would make `STOREFRONT_API_CLIENT` a required
   * provider in the spec of every component that renders a price. The client
   * is only ever needed by `load()`, which no component spec runs.
   */
  private readonly injector = inject(Injector);

  /** The whole payload or nothing. Never partially applied. */
  private readonly config = signal<StorefrontConfig | null>(null);

  /**
   * The runtime config (DR-31): identity, brand, locale set, money, domains.
   * Null until the first read lands, which is what `runtime` falls back for.
   */
  private readonly runtimeConfig = signal<StorefrontRuntimeConfig | null>(null);

  /** In-flight load, so a second `load()` cannot fan out to a second request. */
  private inFlight: Promise<void> | null = null;

  /** False while the storefront is running on its baked defaults. */
  readonly loaded = computed(() => this.config() !== null);

  /**
   * The configured store name, or null when the store has not been named.
   *
   * It came from the narrow endpoint and was deliberately unwired, because the
   * previous client's brand floor fixed the name as a build constant. There is
   * no build constant now: the engine is one generic build and the name is a
   * config value, so this is the source every surface reads (plan E2.5 wires
   * the remaining ones).
   */
  readonly storeName = computed(() => this.identity().storeName || null);

  readonly contactEmail = computed(() => this.identity().contact.email || null);
  readonly phone = computed(() => this.identity().contact.phone || null);
  readonly logoUrl = computed(() => this.config()?.identity.logoUrl ?? null);

  /** Sorted by platform so the footer's link order cannot depend on JSON key
   * order, which differs between the server pass and the transferred copy. */
  readonly socialLinks = computed<StoreSocialLink[]>(() =>
    Object.entries(this.config()?.identity.socialLinks ?? {})
      .map(([platform, url]) => ({ platform, url }))
      .sort((a, b) => a.platform.localeCompare(b.platform)),
  );

  /**
   * The runtime config, or the committed neutral one while the first read is
   * still in flight. Never null, so no caller has to invent a currency, a
   * locale or a colour of its own for that gap.
   */
  readonly runtime = computed<StorefrontRuntimeConfig>(
    () => this.runtimeConfig() ?? NEUTRAL_STOREFRONT_RUNTIME_CONFIG,
  );

  /** True once the runtime config itself has landed, fallback aside. */
  readonly runtimeLoaded = computed(() => this.runtimeConfig() !== null);

  readonly money = computed(() => this.runtime().money);
  readonly localization = computed(() => this.runtime().localization);
  readonly brand = computed(() => this.runtime().brand);
  readonly identity = computed(() => this.runtime().identity);
  readonly domains = computed(() => this.runtime().domains);

  /**
   * The locale facts every SEO builder needs: the locales the store serves,
   * its default for `x-default`, and the country the region tail names. One
   * computed so a page never assembles its own and gets a different answer.
   */
  readonly seoLocales = computed(() => ({
    supportedLocales: this.localization().supportedLocales,
    defaultLocale: this.localization().defaultLocale,
    country: this.identity().address.country,
  }));

  readonly currencyCode = computed(() => this.money().currencyCode);

  readonly lowStockThreshold = computed(
    () => this.config()?.inventory.lowStockThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
  );

  readonly pixels = computed(() => this.config()?.pixels ?? { ...NO_PIXELS });

  /**
   * Resolve the config for this render. Called once from the app initializer.
   *
   * Server: fetch through the request-scoped API client, which already carries
   * the request's locale, so the Translatable store name arrives resolved.
   * Browser: read what the server transferred, and fetch only when the key is
   * absent, which is a direct SPA boot or a prerendered page.
   */
  async load(): Promise<void> {
    if (this.config() && this.runtimeConfig()) return;
    this.inFlight ??= this.resolve().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Both endpoints in parallel, each committed on its own. They are two
   * independent reads until E2.6 folds the narrow one into the runtime config,
   * and a failure on either must leave the other's values standing.
   */
  private async resolve(): Promise<void> {
    await Promise.all([this.resolveLegacy(), this.resolveRuntime()]);
  }

  private async resolveLegacy(): Promise<void> {
    if (this.config()) return;
    const transferred = this.readTransferred();
    if (transferred) {
      this.config.set(transferred);
      return;
    }

    const api = this.injector.get(StoreConfigApiService, null);
    if (!api) return;

    try {
      const config = await api.get();
      this.config.set(config);
      if (isPlatformServer(this.platformId)) {
        this.transferState.set(STORE_CONFIG_STATE_KEY, config);
      }
    } catch {
      // Silent by contract. The baked defaults are a complete, correct
      // storefront; a failed config read is not a customer-facing error.
    }
  }

  private async resolveRuntime(): Promise<void> {
    if (this.runtimeConfig()) return;
    const transferred = this.readTransferredRuntime();
    if (transferred) {
      this.runtimeConfig.set(transferred);
      return;
    }

    const api = this.injector.get(StoreRuntimeConfigApiService, null);
    if (!api) return;

    try {
      const config = await api.get();
      this.runtimeConfig.set(config);
      if (isPlatformServer(this.platformId)) {
        this.transferState.set(STORE_RUNTIME_CONFIG_STATE_KEY, config);
      }
    } catch {
      // Same contract as above: the neutral config is a complete storefront.
    }
  }

  /**
   * The transferred payload, re-parsed rather than trusted. It travels through
   * the SSR HTML, so it is the same untrusted boundary the API response is, and
   * a malformed one must fall back rather than reach a template.
   */
  private readTransferred(): StorefrontConfig | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    if (!this.transferState.hasKey(STORE_CONFIG_STATE_KEY)) return null;
    const raw = this.transferState.get(STORE_CONFIG_STATE_KEY, null);
    const parsed = storefrontConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private readTransferredRuntime(): StorefrontRuntimeConfig | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    if (!this.transferState.hasKey(STORE_RUNTIME_CONFIG_STATE_KEY)) return null;
    const raw = this.transferState.get(STORE_RUNTIME_CONFIG_STATE_KEY, null);
    const parsed = storefrontRuntimeConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
}
