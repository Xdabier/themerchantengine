import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PaymentMethodsService,
  type StorefrontPaymentMethod,
} from '../payments/payment-methods.service';
import type { UpdateCheckoutSettingsDto } from './dto/update-checkout-settings.dto';

const GROUP = 'checkout';

/**
 * Defaults returned when a key hasn't been persisted yet. Keeps the
 * admin UI's PATCH body small (operators only ship changes) and the
 * first GET never returns `null` for missing fields.
 */
export interface CheckoutSettings {
  guestCheckoutEnabled: boolean;
  requiredFields: string[];
  termsOfServiceUrl: string | null;
  postPurchaseRedirectUrl: string | null;
  checkoutMessage: string | null;
}

/**
 * The public checkout bootstrap payload. Both halves travel together because
 * the checkout page needs both in one fetch: whether a guest may proceed, and
 * which tenders to render.
 */
export interface StorefrontCheckoutSettings {
  checkout: CheckoutSettings;
  paymentMethods: StorefrontPaymentMethod[];
}

const DEFAULTS: CheckoutSettings = {
  guestCheckoutEnabled: true,
  requiredFields: ['email'],
  termsOfServiceUrl: null,
  postPurchaseRedirectUrl: null,
  checkoutMessage: null,
};

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentMethods: PaymentMethodsService,
  ) {}

  /**
   * Composite public read behind `GET /v1/checkout/settings`.
   *
   * The payment half is delegated to the owning module's service rather than
   * queried here (constitution §3.1): this module never touches
   * `prisma.paymentMethod`, so the secrets-bearing `config` column has exactly
   * one read path in the codebase and it is the admin one.
   */
  async getStorefrontSettings(): Promise<StorefrontCheckoutSettings> {
    const [checkout, paymentMethods] = await Promise.all([
      this.getSettings(),
      this.paymentMethods.listStorefront(),
    ]);
    return { checkout, paymentMethods };
  }

  async getSettings(): Promise<CheckoutSettings> {
    const rows = await this.prisma.storeSetting.findMany({ where: { group: GROUP } });
    const byKey = new Map<string, unknown>();
    for (const row of rows) byKey.set(row.key, row.value);

    return {
      guestCheckoutEnabled:
        this.readBool(byKey.get('guestCheckoutEnabled')) ?? DEFAULTS.guestCheckoutEnabled,
      requiredFields: this.readStringArray(byKey.get('requiredFields')) ?? [
        ...DEFAULTS.requiredFields,
      ],
      termsOfServiceUrl:
        this.readStringOrNull(byKey.get('termsOfServiceUrl')) ?? DEFAULTS.termsOfServiceUrl,
      postPurchaseRedirectUrl:
        this.readStringOrNull(byKey.get('postPurchaseRedirectUrl')) ??
        DEFAULTS.postPurchaseRedirectUrl,
      checkoutMessage:
        this.readStringOrNull(byKey.get('checkoutMessage')) ?? DEFAULTS.checkoutMessage,
    };
  }

  async updateSettings(dto: UpdateCheckoutSettingsDto): Promise<CheckoutSettings> {
    const entries = Object.entries(dto).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      await this.prisma.$transaction(
        entries.map(([key, value]) =>
          this.prisma.storeSetting.upsert({
            where: { group_key: { group: GROUP, key } },
            create: { group: GROUP, key, value: value as never },
            update: { value: value as never },
          }),
        ),
      );
      this.logger.log(`updateSettings: keys=${entries.map(([k]) => k).join(',')}`);
    }
    return this.getSettings();
  }

  private readBool(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private readStringOrNull(value: unknown): string | null {
    if (value === null) return null;
    return typeof value === 'string' ? value : null;
  }

  private readStringArray(value: unknown): string[] | null {
    return Array.isArray(value) && value.every((v) => typeof v === 'string')
      ? (value as string[])
      : null;
  }
}
