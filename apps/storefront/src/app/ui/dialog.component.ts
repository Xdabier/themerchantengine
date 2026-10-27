import { ComponentType } from '@angular/cdk/portal';
import { Dialog, DialogConfig, DialogModule, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject, input } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(Dialog);

  open<R = unknown, D = unknown, C = unknown>(
    component: ComponentType<C>,
    config: DialogConfig<D, DialogRef<R, C>> = {} as DialogConfig<D, DialogRef<R, C>>,
  ): DialogRef<R, C> {
    return this.dialog.open<R, D, C>(component, {
      hasBackdrop: true,
      backdropClass: 'app-dialog-backdrop',
      panelClass: 'app-dialog-panel',
      disableClose: false,
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      ariaModal: true,
      role: 'dialog',
      ...config,
    });
  }

  closeAll(): void {
    this.dialog.closeAll();
  }
}

/**
 * Wraps a dialog body with the brand surface frame. Authors place this at the
 * root of every dialog component so styling stays consistent without forcing a
 * global panel-wrapper class.
 */
@Component({
  selector: 'app-dialog-frame',
  standalone: true,
  imports: [DialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="frame"
      [attr.aria-labelledby]="labelledBy() || null"
      [attr.aria-describedby]="describedBy() || null"
    >
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border-radius: var(--brand-radius-lg);
        box-shadow: var(--brand-shadow-dialog);
        max-inline-size: min(560px, 92vw);
      }
      /* Suppress double focus ring only when focus is elsewhere — keep the
       * brand focus ring whenever the host itself is the focused element. */
      :host(:not(:focus-visible)) {
        outline: none;
      }
      .frame {
        padding: clamp(1.25rem, 4vw, 1.75rem);
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
    `,
  ],
})
export class DialogFrameComponent {
  readonly labelledBy = input<string>('');
  readonly describedBy = input<string>('');
}
