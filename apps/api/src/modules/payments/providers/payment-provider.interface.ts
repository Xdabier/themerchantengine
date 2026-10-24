import type { PaymentStatus, Prisma } from '@prisma/client';
import type { z } from 'zod';

/**
 * A payment provider plug-in (DR-34). Each provider owns its config shape
 * through `configSchema`, which validates `PaymentMethod.config` before any
 * call. Methods return the provider reference and the status the order
 * should record; they never write to the database themselves.
 */
export interface PaymentProvider<TConfig = unknown> {
  readonly id: string;
  readonly configSchema: z.ZodType<TConfig>;

  createSession(input: PaymentSessionInput<TConfig>): Promise<PaymentProviderResult>;
  authorize(input: PaymentOperationInput<TConfig>): Promise<PaymentProviderResult>;
  capture(input: PaymentCaptureInput<TConfig>): Promise<PaymentProviderResult>;
  refund(input: PaymentRefundInput<TConfig>): Promise<PaymentProviderResult>;
  cancel(input: PaymentMutationInput<TConfig>): Promise<PaymentProviderResult>;
  getStatus(input: PaymentOperationInput<TConfig>): Promise<PaymentProviderResult>;
  parseWebhook(input: PaymentWebhookInput<TConfig>): Promise<PaymentWebhookEvent>;
}

export interface PaymentSessionInput<TConfig = unknown> {
  orderId: string;
  amount: Prisma.Decimal;
  currencyCode: string;
  config: TConfig;
}

export interface PaymentOperationInput<TConfig = unknown> {
  reference: string;
  status: PaymentStatus;
  config: TConfig;
}

/** An operation that moves money. */
export interface PaymentMutationInput<TConfig = unknown> extends PaymentOperationInput<TConfig> {
  /**
   * Stable for one logical operation, so a retry after a lost response never
   * moves money twice. Online providers forward it to their API.
   */
  idempotencyKey: string;
}

export interface PaymentCaptureInput<TConfig = unknown> extends PaymentMutationInput<TConfig> {
  amount: Prisma.Decimal;
  currencyCode: string;
}

export interface PaymentRefundInput<TConfig = unknown> extends PaymentMutationInput<TConfig> {
  amount: Prisma.Decimal;
  currencyCode: string;
  /** What is still refundable on this payment before this refund. */
  refundableAmount: Prisma.Decimal;
}

export interface PaymentWebhookInput<TConfig = unknown> {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  config: TConfig;
}

export interface PaymentProviderResult {
  reference: string;
  status: PaymentStatus;
  /** Hosted payment page the shopper is sent to, when the provider has one. */
  redirectUrl?: string;
  /** Client-side token for embedded payment forms, when the provider has one. */
  clientSecret?: string;
}

export interface PaymentWebhookEvent extends PaymentProviderResult {
  /** Provider event id, used for `ProcessedWebhook` dedup. */
  eventId: string;
}
