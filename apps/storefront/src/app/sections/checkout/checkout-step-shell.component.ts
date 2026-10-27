import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';

import { LocaleService } from '../../locale.service';

export type CheckoutStepState = 'pristine' | 'active' | 'complete' | 'invalid';

/**
 * Presentational accordion-step wrapper for the S10 checkout flow.
 *
 * Each step renders a sticky header with a localized step number, title,
 * state badge, and (when state === 'complete') an inline edit button +
 * single-line summary. The body slot accepts the step's form / readout.
 */
@Component({
  selector: 'app-checkout-step-shell',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="step"
      [attr.role]="'region'"
      [attr.aria-labelledby]="headingId()"
      [attr.data-state]="state()"
      [attr.data-step]="step()"
      [attr.data-testid]="testId()"
    >
      <header class="head">
        <span class="step-index" aria-hidden="true">{{ step() }}</span>
        <h2 [id]="headingId()" class="title">{{ title() }}</h2>
        @if (stateLabel()) {
          <span class="badge" [attr.data-state]="state()" aria-hidden="true">{{
            stateLabel()
          }}</span>
        }
        @if (state() === 'complete') {
          <button
            type="button"
            class="edit"
            (click)="editClicked.emit()"
            [attr.aria-label]="editAriaLabel()"
            data-testid="checkout-step-edit"
          >
            {{ strings().checkout.steps.address.edit }}
          </button>
        }
      </header>
      @if (state() === 'complete' && summaryText()) {
        <p class="summary" data-testid="checkout-step-summary">{{ summaryText() }}</p>
      }
      @if (state() === 'active' || state() === 'invalid') {
        <div class="body">
          <ng-content></ng-content>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .step {
        background-color: var(--brand-bg);
        border-block-end: 1px solid var(--brand-border);
        padding-block: 1.25rem;
      }
      .step[data-state='pristine'] .head .title {
        color: var(--brand-text-muted);
      }
      .head {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .step-index {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 1.75rem;
        block-size: 1.75rem;
        background-color: var(--brand-surface);
        color: var(--brand-text);
        font-size: var(--brand-text-body);
        font-weight: 600;
        border: 1px solid var(--brand-border);
      }
      .title {
        margin: 0;
        font-family: var(--brand-font-display);
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
        flex: 1 1 auto;
      }
      .badge {
        font-size: var(--brand-text-micro);
        padding-inline: 0.5rem;
        padding-block: 0.125rem;
        color: var(--brand-text-muted);
        border: 1px solid currentColor;
      }
      .badge[data-state='complete'] {
        color: var(--brand-success-text);
      }
      .badge[data-state='invalid'] {
        color: var(--brand-error);
      }
      .badge[data-state='active'] {
        color: var(--brand-primary);
      }
      .edit {
        background: transparent;
        border: 1px solid var(--brand-border);
        color: var(--brand-text);
        padding-inline: 0.75rem;
        padding-block: 0.25rem;
        font-size: var(--brand-text-body);
        cursor: pointer;
      }
      .edit:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .summary {
        margin-block-start: 0.5rem;
        margin-inline-start: calc(1.75rem + 0.75rem);
        color: var(--brand-text-muted);
        font-size: var(--brand-text-body);
      }
      .body {
        padding-block-start: 1rem;
        padding-inline-start: calc(1.75rem + 0.75rem);
      }
    `,
  ],
})
export class CheckoutStepShellComponent {
  /** Checkout runs five steps since the delivery and payment steps landed. */
  readonly step = input.required<1 | 2 | 3 | 4 | 5>();
  readonly title = input.required<string>();
  readonly state = input<CheckoutStepState>('pristine');
  readonly summaryText = input<string | null>(null);
  readonly testId = input<string>('checkout-step-shell');

  @Output() readonly editClicked = new EventEmitter<void>();

  private readonly locale = inject(LocaleService);
  protected readonly strings = this.locale.strings;
  protected readonly headingId = computed(() => `checkout-step-${this.step()}-title`);
  /**
   * A chip carries the step's state, not a section title.
   *
   * `complete` returned `checkout.steps.summary.title`, so the delivery-address
   * step's chip read "Order summary"; `active` returned the step's own heading,
   * so the chip just repeated the words directly above it. Neither told the
   * shopper anything about where they were in the flow.
   */
  protected readonly stateLabel = computed(() => {
    const s = this.strings().checkout.steps.stepState;
    switch (this.state()) {
      case 'complete':
        return s.complete;
      case 'invalid':
        return s.needsAttention;
      case 'active':
        return s.inProgress;
      default:
        return '';
    }
  });

  /**
   * Names the step it edits. Every edit button reused the address step's own
   * Edit string, so a screen reader heard the same label on all of them.
   */
  protected readonly editAriaLabel = computed(() =>
    this.strings().checkout.steps.editStep.replace('{step}', this.title()),
  );
}
