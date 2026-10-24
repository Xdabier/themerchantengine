import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentProviderUnknownException } from './payment-provider-unknown.exception';
import type {
  PaymentCaptureInput,
  PaymentMutationInput,
  PaymentOperationInput,
  PaymentProvider,
  PaymentProviderResult,
  PaymentRefundInput,
  PaymentSessionInput,
  PaymentWebhookEvent,
  PaymentWebhookInput,
} from './providers/payment-provider.interface';

type WithoutConfig<T> = Omit<T, 'config'>;

interface ResolvedMethod {
  provider: PaymentProvider;
  config: unknown;
}

export interface VerifiedWebhook {
  event: PaymentWebhookEvent;
  methodCodes: string[];
}

const METHOD_SELECT = { provider: true, config: true } as const;

// Documented soft-delete bypass (prisma.service.ts:5-10): naming `deletedAt`
// opts the query out of the automatic `deletedAt: null` filter. `undefined`
// adds no condition of its own, so live and soft-deleted rows both match.
const ANY_ROW = undefined;

/**
 * The one door to payment providers (DR-34). Callers name a payment method
 * code; this service loads its row, validates the stored config against the
 * provider schema and calls the provider. Config never leaves this service.
 */
@Injectable()
export class PaymentGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentProviderRegistry,
  ) {}

  async openSession(
    methodCode: string,
    input: WithoutConfig<PaymentSessionInput>,
  ): Promise<PaymentProviderResult> {
    const { provider, config } = await this.resolveByCode(methodCode, { deletedAt: null });
    return provider.createSession({ ...input, config });
  }

  async authorize(
    methodCode: string,
    input: WithoutConfig<PaymentOperationInput>,
  ): Promise<PaymentProviderResult> {
    const { provider, config } = await this.resolveByCode(methodCode);
    return provider.authorize({ ...input, config });
  }

  async capture(
    methodCode: string,
    input: WithoutConfig<PaymentCaptureInput>,
  ): Promise<PaymentProviderResult> {
    const { provider, config } = await this.resolveByCode(methodCode);
    return provider.capture({ ...input, config });
  }

  async refund(
    methodCode: string,
    input: WithoutConfig<PaymentRefundInput>,
  ): Promise<PaymentProviderResult> {
    const { provider, config } = await this.resolveByCode(methodCode);
    return provider.refund({ ...input, config });
  }

  async cancel(
    methodCode: string,
    input: WithoutConfig<PaymentMutationInput>,
  ): Promise<PaymentProviderResult> {
    const { provider, config } = await this.resolveByCode(methodCode);
    return provider.cancel({ ...input, config });
  }

  async providerIdFor(methodCode: string): Promise<string> {
    const { provider } = await this.resolveByCode(methodCode);
    return provider.id;
  }

  /**
   * Verifies and parses an inbound webhook against every method of the
   * provider. Returns the event from the first that verifies and the codes of
   * all that verify, so the caller only moves orders on those methods.
   * Inactive and soft-deleted methods count: their open orders keep receiving
   * events.
   */
  async parseWebhook(
    providerId: string,
    headers: PaymentWebhookInput['headers'],
    rawBody: Buffer,
  ): Promise<VerifiedWebhook> {
    const provider = this.registry.get(providerId);
    const rows = await this.prisma.paymentMethod.findMany({
      where: { provider: providerId, deletedAt: ANY_ROW },
      select: { code: true, ...METHOD_SELECT },
      orderBy: { sortOrder: 'asc' },
    });
    if (rows.length === 0) throw new PaymentProviderUnknownException(providerId);

    let event: PaymentWebhookEvent | undefined;
    const methodCodes: string[] = [];
    let lastError: unknown;
    for (const row of rows) {
      try {
        const parsed = await provider.parseWebhook({
          headers,
          rawBody,
          config: provider.configSchema.parse(row.config),
        });
        event ??= parsed;
        methodCodes.push(row.code);
      } catch (error) {
        lastError = error;
      }
    }
    if (!event) throw lastError;
    return { event, methodCodes };
  }

  // Inactive and soft-deleted methods still resolve by default: their existing
  // orders must capture, refund or cancel. Only a new session needs a live row.
  private async resolveByCode(
    methodCode: string,
    { deletedAt }: { deletedAt: null | undefined } = { deletedAt: ANY_ROW },
  ): Promise<ResolvedMethod> {
    const row = await this.prisma.paymentMethod.findFirst({
      where: { code: methodCode, deletedAt },
      select: METHOD_SELECT,
    });
    if (!row) throw new PaymentProviderUnknownException(methodCode);
    const provider = this.registry.get(row.provider);
    return { provider, config: provider.configSchema.parse(row.config) };
  }
}
