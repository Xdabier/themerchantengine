import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { LocaleService } from '../../../locale.service';
import { ProductsService } from '@storefront-services';
import type { Locale } from '../../../../i18n/types';

/**
 * `/fr/_smoke/services` and `/en/_smoke/services`, the S1 services-stack smoke
 * page. Fetches the first 5 products through the libs/storefront-services
 * `ProductsService` and renders the parsed payload as JSON inside a hidden
 * `<pre>` so the Playwright spec at
 * `apps/storefront-e2e/src/services.journey.spec.ts` can re-parse the body
 * with the same Zod schema and assert shape parity.
 *
 * Replaced once the real catalog ships in S6.
 *
 * The page is gated to non-production builds: in production the body renders
 * a 404-style `not found` sentinel and emits `noindex, nofollow`.
 */
@Component({
  selector: 'app-services-smoke-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame">
      @if (gateOpen()) {
        <h1 class="heading">{{ heading() }}</h1>
        <p class="status" [attr.data-testid]="'services-smoke-status'">
          {{ statusLabel() }}
        </p>
        <pre
          class="payload"
          [attr.data-testid]="'services-smoke-payload'"
          [attr.data-state]="state()"
          >{{ payloadJson() }}</pre
        >
      } @else {
        <h1 class="heading">{{ notFoundLabel() }}</h1>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-bg);
        color: var(--brand-text);
        min-block-size: 100dvh;
      }

      .frame {
        padding-block: 2rem;
        padding-inline: clamp(1rem, 4vw, 2rem);
      }

      .heading {
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        margin-block-end: 1rem;
      }

      .status {
        font-family: inherit;
        margin-block-end: 1rem;
      }

      .payload {
        font-family: inherit;
        white-space: pre-wrap;
        word-break: break-word;
      }
    `,
  ],
})
export default class ServicesSmokePage implements OnInit {
  private readonly localeService = inject(LocaleService);
  private readonly meta = inject(Meta);
  private readonly products = inject(ProductsService);

  protected readonly state = signal<'pending' | 'ready' | 'error'>('pending');
  protected readonly payload = signal<unknown>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly gateOpen = computed<boolean>(() => {
    // Vite injects PROD/DEV via import.meta.env. Stay open on dev, closed in
    // production builds — constitution §3.13 forbids dev surfaces leaking.
    const isProd =
      typeof import.meta !== 'undefined' &&
      Boolean((import.meta as { env?: { PROD?: boolean } }).env?.PROD);
    return !isProd;
  });

  protected readonly heading = computed(() =>
    this.localeService.locale() === 'fr' ? 'Contrôle des services S1' : 'S1 services smoke',
  );

  protected readonly notFoundLabel = computed(() =>
    this.localeService.locale() === 'fr' ? 'Introuvable' : 'Not found',
  );

  private readonly statusLabels: Record<
    Locale,
    { pending: string; ready: string; error: string; unknown: string }
  > = {
    fr: { pending: 'chargement…', ready: 'prêt', error: 'erreur', unknown: 'inconnu' },
    en: { pending: 'loading…', ready: 'ready', error: 'error', unknown: 'unknown' },
    ar: { pending: 'جاري التحميل…', ready: 'جاهز', error: 'خطأ', unknown: 'غير معروف' },
  };

  protected readonly statusLabel = computed(() => {
    const map = this.statusLabels[this.localeService.locale()];
    if (this.state() === 'pending') return map.pending;
    if (this.state() === 'error') return `${map.error}: ${this.errorMessage() ?? map.unknown}`;
    return map.ready;
  });

  protected readonly payloadJson = computed(() => {
    if (this.state() === 'pending') return '';
    return JSON.stringify(this.payload(), null, 2);
  });

  ngOnInit(): void {
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    if (!this.gateOpen()) return;
    void this.runSmoke();
  }

  private async runSmoke(): Promise<void> {
    try {
      const result = await this.products.list({ page: 1, pageSize: 5 });
      this.payload.set(result);
      this.state.set('ready');
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
      this.state.set('error');
      this.payload.set({ error: this.errorMessage() });
    }
  }
}
