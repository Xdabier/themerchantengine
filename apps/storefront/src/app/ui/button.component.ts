import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgClass } from '@angular/common';

import { SpinnerComponent } from './spinner.component';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonType = 'button' | 'submit' | 'reset';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [NgClass, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type()"
      [disabled]="disabled() || loading()"
      [attr.aria-disabled]="disabled() || loading() ? 'true' : null"
      [attr.aria-busy]="loading() ? 'true' : null"
      [attr.aria-label]="ariaLabel() || null"
      [attr.data-testid]="testId() || null"
      [ngClass]="classes()"
      (click)="onClick($event)"
    >
      @if (loading()) {
        <app-spinner [size]="spinnerSize()" />
      }
      <ng-content />
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        font: inherit;
        font-weight: 500;
        line-height: 1.2;
        cursor: pointer;
        border: 1px solid transparent;
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        transition:
          background-color var(--brand-motion-duration) var(--brand-motion-easing),
          border-color var(--brand-motion-duration) var(--brand-motion-easing),
          color var(--brand-motion-duration) var(--brand-motion-easing);
        padding-block: 0.5rem;
        padding-inline: 1rem;
        min-block-size: 44px;
      }

      button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      button:not(:disabled):active {
        transform: scale(0.95);
      }

      .size-sm {
        /* Tap-area floor stays at 44px per §3.10; visual height kept compact
         * via reduced padding + smaller font. Hit area = padding-box. */
        min-block-size: 44px;
        padding-block: 0.375rem;
        padding-inline: 0.75rem;
        font-size: var(--brand-text-micro);
      }

      .size-md {
        min-block-size: 44px;
        font-size: var(--brand-text-body);
      }

      .size-lg {
        min-block-size: 52px;
        padding-block: 0.75rem;
        padding-inline: 1.5rem;
        font-size: var(--brand-text-product);
      }

      .variant-primary {
        background-color: var(--brand-primary);
        color: var(--brand-on-primary);
      }

      .variant-primary:not(:disabled):hover,
      .variant-primary:not(:disabled):focus-visible {
        background-color: var(--brand-primary-dark);
      }

      /* Inverse text under 16px must not sit on the raw primary. The small
         size renders at --brand-text-micro, so it grounds on the hover step at
         rest. The shared primary hover resolves to that same colour, so this
         size steps down to the pressed step on hover and keeps a visible
         change. Two classes, to outrank the shared hover rule. */
      .variant-primary.size-sm {
        background-color: var(--brand-primary-dark);
      }

      .variant-primary.size-sm:not(:disabled):hover,
      .variant-primary.size-sm:not(:disabled):focus-visible {
        background-color: var(--brand-primary-pressed);
      }

      .variant-secondary {
        background-color: transparent;
        color: var(--brand-primary);
        border-color: var(--brand-primary);
      }

      .variant-secondary:not(:disabled):hover,
      .variant-secondary:not(:disabled):focus-visible {
        background-color: var(--brand-surface-strong);
      }

      .variant-tertiary {
        background-color: transparent;
        color: var(--brand-primary);
      }

      .variant-tertiary:not(:disabled):hover,
      .variant-tertiary:not(:disabled):focus-visible {
        background-color: var(--brand-surface-strong);
      }

      /* The label is the inverse neutral, not the on-primary token: the error
         colour is fitted to carry text on a light page, so it is always dark,
         and an on-primary that resolved dark for a light brand would have put
         dark text on a dark ground. */
      .variant-danger {
        background-color: var(--brand-error);
        color: var(--brand-text-inverse);
      }

      .variant-danger:not(:disabled):hover,
      .variant-danger:not(:disabled):focus-visible {
        background-color: var(--brand-error-hover);
      }

      @media (prefers-reduced-motion: reduce) {
        button:not(:disabled):active {
          transform: none;
        }
      }

      .full-width {
        inline-size: 100%;
      }
    `,
  ],
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<ButtonType>('button');
  readonly disabled = input<boolean>(false);
  readonly loading = input<boolean>(false);
  readonly fullWidth = input<boolean>(false);
  readonly ariaLabel = input<string>('');
  /**
   * Test hook, rendered as `data-testid` on the interactive `<button>`.
   * Fourteen call sites already passed `testId="..."`; without this input it
   * landed as a bare `testid` attribute on the host element, which nothing
   * selects, so all of them were unreachable from a test.
   */
  readonly testId = input<string>('');

  readonly clicked = output<MouseEvent>();

  protected readonly classes = computed(() => ({
    [`variant-${this.variant()}`]: true,
    [`size-${this.size()}`]: true,
    'full-width': this.fullWidth(),
  }));

  protected readonly spinnerSize = computed(() => {
    const map: Record<ButtonSize, 'sm' | 'md'> = { sm: 'sm', md: 'sm', lg: 'md' };
    return map[this.size()];
  });

  protected onClick(event: MouseEvent): void {
    if (this.disabled() || this.loading()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    this.clicked.emit(event);
  }
}
