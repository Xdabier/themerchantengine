import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { pickTranslation, type ProductFaq, type ResolvedString } from '@storefront-types';

import { LocaleService } from '../../locale.service';

export interface FaqRow {
  id: string;
  question: string;
  answer: string;
}

@Component({
  selector: 'product-faqs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length > 0) {
      <section class="faqs" [attr.aria-labelledby]="titleId" data-testid="product-faqs">
        <h2 [id]="titleId" class="title">{{ strings().product.faqs.title }}</h2>
        <ul class="list" role="list">
          @for (row of rows(); track row.id) {
            <li class="row">
              <details class="item">
                <summary class="question">
                  <span class="question-text">{{ row.question }}</span>
                  <span class="chevron" aria-hidden="true">+</span>
                </summary>
                <div class="answer">{{ row.answer }}</div>
              </details>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .faqs {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        border-block-start: 1px solid var(--brand-border);
      }
      .row {
        display: block;
        border-block-end: 1px solid var(--brand-border);
      }
      .item {
        display: block;
      }
      .question {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding-block: 1rem;
        padding-inline: 0;
        cursor: pointer;
        list-style: none;
        font-size: var(--brand-text-body);
        font-weight: 500;
        color: var(--brand-text);
        min-block-size: 44px;
      }
      .question::-webkit-details-marker {
        display: none;
      }
      .question:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .question-text {
        flex: 1 1 auto;
      }
      .chevron {
        flex: 0 0 auto;
        font-size: 1.25rem;
        line-height: 1;
        color: var(--brand-text-muted, var(--brand-text));
        transition: transform var(--brand-motion-duration) var(--brand-motion-easing);
      }
      .item[open] .chevron {
        transform: rotate(45deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .chevron {
          transition: none;
        }
      }
      .answer {
        padding-block-end: 1rem;
        padding-inline-end: 2rem;
        color: var(--brand-text);
        font-size: var(--brand-text-body);
        line-height: 1.6;
        white-space: pre-wrap;
      }
    `,
  ],
})
export class ProductFaqsComponent {
  readonly faqs = input<ProductFaq[]>([]);

  protected readonly titleId = `product-faqs-${++faqsId}`;

  private readonly localeService = inject(LocaleService);
  protected readonly strings = computed(() => this.localeService.strings());

  protected readonly rows = computed<FaqRow[]>(() => {
    const locale = this.localeService.locale();
    return this.faqs()
      .map((f, i) => ({
        id: f.id ?? `faq-${i}`,
        question: pickTranslation(f.question as ResolvedString, locale),
        answer: pickTranslation(f.answer as ResolvedString, locale),
      }))
      .filter((r) => r.question && r.answer);
  });
}

let faqsId = 0;
