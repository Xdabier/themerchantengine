import { Inject, Injectable } from '@angular/core';
import {
  apiResponseSchema,
  subscribeNewsletterRequestSchema,
  subscribeNewsletterResponseSchema,
  type SubscribeNewsletterRequest,
  type SubscribeNewsletterResponse,
} from '@storefront-types';
import { STOREFRONT_API_CLIENT, type ApiClient } from '../shared/api-client.token';

/**
 * Public newsletter signup (NE9). Posts to the `@Public()` double-opt-in
 * endpoint; the response is intentionally neutral (enumeration-safe), so the
 * UI shows the same "check your inbox" message regardless of prior state.
 */
@Injectable({ providedIn: 'root' })
export class NewsletterService {
  constructor(@Inject(STOREFRONT_API_CLIENT) private readonly api: ApiClient) {}

  /**
   * Subscribe to the newsletter. `bot` carries the bot-protection signals — the
   * Cloudflare Turnstile token and the honeypot value — as headers
   * (`x-captcha-response` / `x-hp-field`), mirroring the sign-up form, so the
   * request body stays a clean `{ email, locale }`. The honeypot is always sent
   * (empty for real users); the token only when a site key is configured.
   */
  async subscribe(
    input: SubscribeNewsletterRequest,
    bot?: { captchaToken?: string | null; honeypot?: string | null },
  ): Promise<SubscribeNewsletterResponse> {
    const body = subscribeNewsletterRequestSchema.parse(input);
    const headers: Record<string, string> = { 'x-hp-field': bot?.honeypot ?? '' };
    if (bot?.captchaToken) headers['x-captcha-response'] = bot.captchaToken;
    const envelope = await this.api.post<unknown>('/v1/newsletter/subscribe', body, { headers });
    return apiResponseSchema(subscribeNewsletterResponseSchema).parse(envelope).data;
  }
}
