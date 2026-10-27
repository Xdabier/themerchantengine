import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  inject,
  input,
  signal,
} from '@angular/core';

export type ToastVariant = 'success' | 'warning' | 'error';

export interface Toast {
  readonly id: number;
  readonly variant: ToastVariant;
  readonly message: string;
  readonly dismissAfterMs: number | null;
}

const DEFAULT_DURATION_MS = 5000;
const STACK_CAP = 3;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();
  private nextId = 1;

  push(variant: ToastVariant, message: string, dismissAfterMs?: number | null): number {
    const id = this.nextId++;
    const sticky = variant === 'error' ? null : (dismissAfterMs ?? DEFAULT_DURATION_MS);
    const toast: Toast = { id, variant, message, dismissAfterMs: sticky };
    const next = [...this._toasts(), toast].slice(-STACK_CAP);
    this._toasts.set(next);
    if (sticky !== null) {
      setTimeout(() => this.dismiss(id), sticky);
    }
    return id;
  }

  success(message: string): number {
    return this.push('success', message);
  }
  warning(message: string): number {
    return this.push('warning', message);
  }
  error(message: string): number {
    return this.push('error', message);
  }

  dismiss(id: number): void {
    this._toasts.set(this._toasts().filter((t) => t.id !== id));
  }
}

@Component({
  selector: 'app-toast-container',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- No container-level aria-live: per-item role="status" / role="alert"
         each carry implicit live semantics. Stacking polite over assertive
         can suppress interruption in JAWS — handle priority per-item. -->
    <div class="stack" data-testid="toast-stack">
      @for (t of toasts(); track t.id) {
        <div
          class="toast"
          [class]="'v-' + t.variant"
          [attr.role]="t.variant === 'success' ? 'status' : 'alert'"
          [attr.data-testid]="'toast-' + t.variant"
        >
          <span class="message">{{ t.message }}</span>
          <button
            type="button"
            class="close"
            [attr.aria-label]="dismissLabel()"
            (click)="dismiss(t.id)"
          >
            ×
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset-block-end: 1rem;
        inset-inline-end: 1rem;
        z-index: 60;
        pointer-events: none;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-inline-size: min(360px, 92vw);
      }
      .toast {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-text);
        color: var(--brand-on-primary);
        border-radius: var(--brand-radius-md);
        font-size: var(--brand-text-body);
        pointer-events: auto;
        box-shadow: var(--brand-shadow-toast);
      }
      /* Each variant overrides only the ground, so each names its label too.
         The label is the generated on-functional token, which the palette fits
         against all four state colours; the variants used to take the page
         text colour, which measured between 2.3:1 and 3.4:1 depending on the
         install and was live on every confirmation toast. */
      .v-success {
        background-color: var(--brand-success);
        color: var(--brand-on-functional);
      }
      .v-warning {
        background-color: var(--brand-warning);
        color: var(--brand-on-functional);
      }
      .v-error {
        background-color: var(--brand-error);
        color: var(--brand-on-functional);
      }
      .message {
        flex: 1;
      }
      .close {
        background: transparent;
        color: inherit;
        border: none;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0.5rem;
        min-inline-size: 44px;
        min-block-size: 44px;
      }
      .close:focus-visible {
        outline: 2px solid var(--brand-on-primary);
        outline-offset: 1px;
      }
    `,
  ],
})
export class ToastContainerComponent {
  private readonly svc = inject(ToastService);
  protected readonly toasts = this.svc.toasts;
  /** Bilingual dismiss aria-label. Consumers MUST pass a locale-resolved
   * string; the English default is a development fallback only. */
  readonly dismissLabel = input<string>('Dismiss');

  protected dismiss(id: number): void {
    this.svc.dismiss(id);
  }
}
