import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_PROVIDERS } from './payments.constants';
import { PaymentProviderUnknownException } from './payment-provider-unknown.exception';
import type { PaymentProvider } from './providers/payment-provider.interface';

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Resolves `PaymentMethod.provider` to the provider that handles it. */
@Injectable()
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(@Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[]) {
    for (const provider of providers) {
      if (!PROVIDER_ID_PATTERN.test(provider.id)) {
        throw new Error(`Invalid payment provider id "${provider.id}": use lower snake case`);
      }
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate payment provider id "${provider.id}"`);
      }
      this.providers.set(provider.id, provider);
    }
  }

  get(id: string): PaymentProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new PaymentProviderUnknownException(id);
    return provider;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  list(): PaymentProvider[] {
    return [...this.providers.values()];
  }
}
