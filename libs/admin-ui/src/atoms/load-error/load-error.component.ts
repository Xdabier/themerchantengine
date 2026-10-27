import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '../button/button.component';

/**
 * Shared load-failure surface (admin-qa-remediation plan E, finding E11).
 *
 * A failed fetch used to leave either a blank screen or a quietly empty
 * control, both indistinguishable from "there is no data". Every fetch failure
 * now renders this block: what failed, and a way to try again.
 *
 * Two shapes:
 *  - default — the primary fetch of a screen failed; the block replaces the
 *    list body.
 *  - compact — a companion lookup failed and the screen still works in a
 *    degraded way; the block sits above the affected control.
 *
 * The message is operator-facing English chrome (constitution §3.2), never
 * a raw backend stack trace.
 */
@Component({
  selector: 'app-load-error',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="rootClass()" role="alert" [attr.data-testid]="testId()">
      <p [class]="messageClass()">{{ message() }}</p>
      @if (showRetry()) {
        <app-button
          variant="secondary"
          size="sm"
          [loading]="retrying()"
          (clicked)="retry.emit()"
          [testId]="retryTestId()"
          [ariaLabel]="retryAriaLabel()"
        >
          Retry
        </app-button>
      }
    </div>
  `,
})
export class LoadErrorComponent {
  readonly message = input.required<string>();
  readonly compact = input<boolean>(false);
  readonly retrying = input<boolean>(false);
  readonly showRetry = input<boolean>(true);
  readonly testId = input<string | null>(null);
  /** Names the control when several load-error blocks share one screen. */
  readonly retryLabel = input<string | null>(null);

  readonly retry = output<void>();

  protected readonly retryTestId = computed(() => {
    const id = this.testId();
    return id ? `${id}-retry` : null;
  });

  protected readonly retryAriaLabel = computed(() => {
    const label = this.retryLabel();
    return label ? `Retry: ${label}` : null;
  });

  protected rootClass(): string {
    return this.compact()
      ? 'flex items-center justify-between gap-3 flex-wrap border border-status-error bg-surface px-3 py-2'
      : 'flex items-center justify-between gap-4 flex-wrap border border-status-error bg-surface p-4';
  }

  protected messageClass(): string {
    return this.compact() ? 'tabular text-xs text-ink' : 'tabular text-sm text-ink';
  }
}
