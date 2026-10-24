import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Inject, Optional, input } from '@angular/core';
import { ButtonComponent } from '../../atoms/button/button.component';

/**
 * Brand-styled confirmation dialog built on @angular/cdk/dialog.
 * CDK provides focus trap + backdrop + Esc-to-close out of the box — we only
 * layer brutalist styling + standardized action buttons on top.
 */

let dialogInstanceCounter = 0;

export interface ConfirmDialogData {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'neutral' | 'destructive';
  /** Caller-supplied stable ids so the CDK container can reference the heading + body. */
  titleId?: string;
  bodyId?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-full max-w-md bg-surface border border-line p-6">
      <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
        {{ data.title }}
      </h2>
      @if (data.body) {
        <p [id]="bodyId" class="mt-4 text-sm text-ink-muted">{{ data.body }}</p>
      }
      <div class="mt-8 flex items-center justify-end gap-3">
        <app-button variant="ghost" (clicked)="cancel()">{{
          data.cancelLabel ?? 'Cancel'
        }}</app-button>
        <app-button
          [variant]="data.tone === 'destructive' ? 'destructive' : 'primary'"
          (clicked)="confirm()"
          data-testid="confirm-dialog-confirm"
        >
          {{ data.confirmLabel ?? 'Confirm' }}
        </app-button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  readonly titleId: string;
  readonly bodyId: string;

  constructor(
    private readonly ref: DialogRef<boolean>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: ConfirmDialogData,
  ) {
    // `openConfirmDialog` always supplies these ids so the CDK ariaLabelledBy
    // reference and the rendered heading's [id] stay in sync. The constructor
    // never advances the counter — a direct-instantiation path without
    // caller-supplied ids would get a stale id, which is acceptable because
    // no such path exists in the app today.
    this.titleId = data.titleId ?? `dlg-${dialogInstanceCounter}-title`;
    this.bodyId = data.bodyId ?? `dlg-${dialogInstanceCounter}-body`;
  }

  confirm(): void {
    this.ref.close(true);
  }
  cancel(): void {
    this.ref.close(false);
  }
}

/**
 * Service-style helper wrapping CDK Dialog for typed, pre-styled confirmations.
 */
@Component({
  selector: 'app-dialog-host',
  standalone: true,
  template: '',
})
export class DialogHostComponent {
  readonly trigger = input<string>('open');
  // placeholder host — real usage is via openConfirmDialog below.
}

export async function openConfirmDialog(dialog: Dialog, data: ConfirmDialogData): Promise<boolean> {
  const instance = ++dialogInstanceCounter;
  const titleId = data.titleId ?? `dlg-${instance}-title`;
  const bodyId = data.bodyId ?? `dlg-${instance}-body`;
  const ref = dialog.open<boolean>(ConfirmDialogComponent, {
    data: { ...data, titleId, bodyId },
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    ariaModal: true,
    role: 'dialog',
    // CDK falls back to ariaLabel when the labelledby target is not yet
    // mounted; keep both so the accessible name resolves either way.
    ariaLabel: data.title,
    ariaLabelledBy: titleId,
    ariaDescribedBy: data.body ? bodyId : undefined,
    hasBackdrop: true,
    disableClose: false,
  });
  return (await firstValue(ref.closed)) ?? false;
}

function firstValue<T>(obs: {
  subscribe: (fn: (value: T) => void) => { unsubscribe: () => void };
}): Promise<T | undefined> {
  return new Promise((resolve) => {
    const sub = obs.subscribe((value) => {
      resolve(value);
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}

export { Dialog as CdkDialog };
