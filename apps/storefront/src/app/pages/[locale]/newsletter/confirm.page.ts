import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';

import { LocaleService } from '../../../locale.service';
import { pageTitle } from '../../../../lib/seo';

/**
 * `/{locale}/newsletter/confirm` — the landing page the API redirects to after a
 * double-opt-in confirm (`?status=confirmed`), a footer unsubscribe
 * (`?status=unsubscribed`), or a bad/expired token (`?status=invalid`). One page
 * handles every state; the API has already performed the mutation.
 */
type ConfirmState = 'confirmed' | 'unsubscribed' | 'invalid';

@Component({
  selector: 'app-newsletter-confirm-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="frame"
      aria-labelledby="newsletter-confirm-heading"
      data-testid="newsletter-confirm-page"
    >
      <h1
        id="newsletter-confirm-heading"
        class="heading"
        [attr.data-testid]="'newsletter-confirm-' + state()"
      >
        {{ copy().title }}
      </h1>
      <p class="body">{{ copy().body }}</p>
    </section>
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
        max-inline-size: 640px;
        margin-inline: auto;
        padding-block: clamp(3rem, 8vw, 6rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        text-align: center;
      }
      .heading {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        line-height: 1.2;
      }
      .body {
        margin: 0;
        font-size: var(--brand-text-body);
        line-height: 1.7;
      }
    `,
  ],
})
export default class NewsletterConfirmPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly localeService = inject(LocaleService);
  private readonly titleSvc = inject(Title);

  protected readonly locale = this.localeService.locale;
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: null });

  protected readonly state = computed<ConfirmState>(() => {
    const raw = this.query()?.get('status');
    return raw === 'confirmed' || raw === 'unsubscribed' ? raw : 'invalid';
  });

  protected readonly copy = computed(
    () => this.localeService.strings().newsletterConfirm[this.state()],
  );

  ngOnInit(): void {
    // The store name comes from the runtime config through the chrome map
    // (plan E2.5). This line named the previous client until D2, and the copy
    // table that sat three lines above it named the client until gate B.
    this.titleSvc.setTitle(
      pageTitle(
        `${this.copy().title} · ${this.localeService.strings().brand.name}`,
        this.localeService.strings().brand.name,
      ),
    );
  }
}
