import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  TextareaComponent,
  openConfirmDialog,
} from '@admin-ui';
import {
  ReturnsService,
  type Return,
  type ReturnDetail,
  type ReturnRefundMethod,
  type RestockDecision,
} from '@admin-services';
import {
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNotFoundError,
  pickTranslation,
} from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { canRun, type ReturnAction } from './returns.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

type PanelKind = 'reject' | 'receive' | 'refund' | null;

type ReceiveItemForm = FormGroup<{
  returnItemId: FormControl<string>;
  restockDecision: FormControl<RestockDecision>;
  notes: FormControl<string>;
}>;

/**
 * Return mutation actions: approve, reject, receive, refund, close.
 *
 * Gating
 * - `canManage` reflects the `returns:update` permission from the parent;
 *   with it false the component renders nothing.
 * - Each action is additionally gated by the return's current status via
 *   `canRun()` — this mirrors the API's 409 responses on invalid transitions.
 *
 * Parent handshake
 * - Emits `returnChanged` with the fresh record so the detail page can update
 *   its local signal without an extra round-trip.
 */
@Component({
  selector: 'app-return-actions',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    TextareaComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (canManage()) {
      <section
        class="border border-line bg-surface"
        data-testid="return-actions"
        aria-labelledby="return-actions-heading"
      >
        <header class="px-5 py-4 border-b border-line flex items-center justify-between">
          <h2 id="return-actions-heading" class="text-xs tracking-widest uppercase text-ink-muted">
            Actions
          </h2>
          <span role="status" aria-live="polite" aria-atomic="true">
            @if (lastAction()) {
              <app-badge
                [tone]="error() ? 'error' : 'success'"
                [ariaLabel]="
                  error() ? 'Action failed: ' + (error() ?? '') : lastAction() + ' completed'
                "
              >
                {{ error() ? 'Failed' : 'Saved' }}
              </app-badge>
            }
          </span>
        </header>

        <div class="p-5 flex flex-col gap-5">
          @if (error()) {
            <p
              class="border border-status-error text-ink p-3 tabular text-xs"
              data-testid="return-action-error"
              role="alert"
            >
              {{ error() }}
            </p>
          }

          <div class="flex flex-wrap items-center gap-2">
            <app-button
              variant="primary"
              size="sm"
              [disabled]="busy() || !allowed('approve')"
              [loading]="busy() && action() === 'approve'"
              (clicked)="confirmApprove()"
              data-testid="return-approve"
            >
              Approve
            </app-button>
            <app-button
              variant="secondary"
              size="sm"
              [disabled]="busy() || !allowed('reject') || panel() === 'reject'"
              [ariaExpanded]="panel() === 'reject'"
              ariaControls="return-reject-panel"
              (clicked)="openPanel('reject')"
              data-testid="return-reject-open"
            >
              Reject
            </app-button>
            <app-button
              variant="secondary"
              size="sm"
              [disabled]="busy() || !allowed('receive') || panel() === 'receive'"
              [ariaExpanded]="panel() === 'receive'"
              ariaControls="return-receive-panel"
              (clicked)="openPanel('receive')"
              data-testid="return-receive-open"
            >
              Receive items
            </app-button>
            <app-button
              variant="secondary"
              size="sm"
              [disabled]="busy() || !allowed('refund') || panel() === 'refund'"
              [ariaExpanded]="panel() === 'refund'"
              ariaControls="return-refund-panel"
              (clicked)="openPanel('refund')"
              data-testid="return-refund-open"
            >
              Process refund
            </app-button>
            <app-button
              variant="destructive"
              size="sm"
              [disabled]="busy() || !allowed('close')"
              [loading]="busy() && action() === 'close'"
              (clicked)="confirmClose()"
              data-testid="return-close"
            >
              Close
            </app-button>
          </div>

          @if (panel() === 'reject') {
            <form
              id="return-reject-panel"
              [formGroup]="rejectForm"
              (ngSubmit)="submitReject()"
              class="flex flex-col gap-3 border border-line p-4"
              data-testid="return-reject-panel"
              novalidate
            >
              <app-form-field
                label="Rejection reason"
                fieldId="return-reject-reason"
                [error]="rejectError()"
                [hint]="'Sent to the customer as the reason the request was declined.'"
              >
                <app-textarea
                  id="return-reject-reason"
                  formControlName="reason"
                  [rows]="3"
                  [invalid]="!!rejectError()"
                />
              </app-form-field>
              <div class="flex justify-end gap-2">
                <app-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  (clicked)="closePanel()"
                  data-testid="return-reject-cancel"
                >
                  Cancel
                </app-button>
                <app-button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  [disabled]="rejectForm.invalid || busy()"
                  [loading]="busy() && action() === 'reject'"
                  data-testid="return-reject-submit"
                >
                  Reject return
                </app-button>
              </div>
            </form>
          }

          @if (panel() === 'receive') {
            <form
              id="return-receive-panel"
              [formGroup]="receiveForm"
              (ngSubmit)="submitReceive()"
              class="flex flex-col gap-3 border border-line p-4"
              data-testid="return-receive-panel"
              novalidate
            >
              @if (receiveForm.controls.items.length === 0) {
                <p class="text-sm tabular text-ink-muted">This return has no items to receive.</p>
              } @else {
                <div formArrayName="items" class="flex flex-col gap-4">
                  @for (
                    ctrl of receiveForm.controls.items.controls;
                    track itemIdAt($index);
                    let i = $index
                  ) {
                    <div
                      [formGroupName]="i"
                      class="flex flex-col md:flex-row md:items-end gap-3 border border-line p-3"
                    >
                      <div class="flex-1">
                        <p class="text-xs tracking-widest uppercase text-ink-muted">
                          Item {{ i + 1 }}
                        </p>
                        <p class="text-sm tabular text-ink mt-1">
                          {{ itemLabelAt(i) }}
                        </p>
                      </div>
                      <div class="flex flex-col gap-1">
                        <label
                          [for]="'receive-decision-' + i"
                          class="text-xs tracking-widest uppercase text-ink-muted"
                        >
                          Restock decision
                        </label>
                        <select
                          [id]="'receive-decision-' + i"
                          formControlName="restockDecision"
                          class="min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
                          [attr.aria-invalid]="
                            ctrl.controls.restockDecision.invalid ? 'true' : null
                          "
                          [attr.aria-describedby]="
                            ctrl.controls.restockDecision.invalid &&
                            ctrl.controls.restockDecision.touched
                              ? 'receive-decision-' + i + '-error'
                              : null
                          "
                          [attr.data-testid]="'return-receive-decision-' + i"
                        >
                          <option value="RESTOCK">Restock</option>
                          <option value="DAMAGED">Damaged</option>
                          <option value="DISPOSE">Dispose</option>
                        </select>
                        @if (
                          ctrl.controls.restockDecision.invalid &&
                          ctrl.controls.restockDecision.touched
                        ) {
                          <p
                            [id]="'receive-decision-' + i + '-error'"
                            role="alert"
                            class="text-xs tabular text-ink border-l-2 border-status-error pl-2 py-0.5"
                          >
                            Pick a restock decision.
                          </p>
                        }
                      </div>
                      <div class="flex-1">
                        <app-form-field
                          label="Notes"
                          [fieldId]="'receive-notes-' + i"
                          [hint]="'Optional. Up to 500 characters.'"
                        >
                          <app-textarea
                            [id]="'receive-notes-' + i"
                            formControlName="notes"
                            [rows]="2"
                          />
                        </app-form-field>
                      </div>
                    </div>
                  }
                </div>
              }
              <div class="flex justify-end gap-2">
                <app-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  (clicked)="closePanel()"
                  data-testid="return-receive-cancel"
                >
                  Cancel
                </app-button>
                <app-button
                  type="submit"
                  variant="primary"
                  size="sm"
                  [disabled]="
                    receiveForm.invalid || receiveForm.controls.items.length === 0 || busy()
                  "
                  [loading]="busy() && action() === 'receive'"
                  data-testid="return-receive-submit"
                >
                  Record receipt
                </app-button>
              </div>
            </form>
          }

          @if (panel() === 'refund') {
            <form
              id="return-refund-panel"
              [formGroup]="refundForm"
              (ngSubmit)="submitRefund()"
              class="flex flex-col gap-3 border border-line p-4"
              data-testid="return-refund-panel"
              novalidate
            >
              <app-form-field
                label="Refund method"
                fieldId="return-refund-method"
                [error]="refundMethodError()"
              >
                <select
                  id="return-refund-method"
                  formControlName="refundMethod"
                  class="min-h-[44px] w-full px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
                  [attr.aria-invalid]="refundForm.controls.refundMethod.invalid ? 'true' : null"
                  [attr.aria-describedby]="
                    refundMethodError() ? 'return-refund-method-error' : null
                  "
                  data-testid="return-refund-method"
                >
                  <option value="ORIGINAL_PAYMENT">Original payment</option>
                  <option value="STORE_CREDIT">Store credit</option>
                  <option value="EXCHANGE">Exchange</option>
                </select>
              </app-form-field>
              <app-form-field
                label="Notes"
                fieldId="return-refund-notes"
                [hint]="'Optional. Up to 1000 characters.'"
              >
                <app-textarea id="return-refund-notes" formControlName="notes" [rows]="3" />
              </app-form-field>
              <div class="flex justify-end gap-2">
                <app-button
                  type="button"
                  variant="ghost"
                  size="sm"
                  (clicked)="closePanel()"
                  data-testid="return-refund-cancel"
                >
                  Cancel
                </app-button>
                <app-button
                  type="submit"
                  variant="primary"
                  size="sm"
                  [disabled]="refundForm.invalid || busy()"
                  [loading]="busy() && action() === 'refund'"
                  data-testid="return-refund-submit"
                >
                  Process refund
                </app-button>
              </div>
            </form>
          }
        </div>
      </section>
    }
  `,
})
export class ReturnActionsComponent {
  private readonly returnsService = inject(ReturnsService);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);

  readonly return = input.required<ReturnDetail>();
  readonly canManage = input<boolean>(false);
  readonly returnChanged = output<Return>();

  readonly busy = signal(false);
  readonly action = signal<ReturnAction | null>(null);
  readonly panel = signal<PanelKind>(null);
  readonly error = signal<string | null>(null);
  readonly lastAction = signal<string | null>(null);
  private panelTrigger: HTMLElement | null = null;

  readonly status = computed(() => this.return().status);

  readonly rejectForm = this.fb.nonNullable.group({
    reason: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(1000)]],
  });

  readonly refundForm = this.fb.nonNullable.group({
    refundMethod: this.fb.nonNullable.control<ReturnRefundMethod>('ORIGINAL_PAYMENT', [
      Validators.required,
    ]),
    notes: ['', [Validators.maxLength(1000)]],
  });

  readonly receiveForm = this.fb.nonNullable.group({
    items: this.fb.nonNullable.array<ReceiveItemForm>([]),
  });

  allowed(action: ReturnAction): boolean {
    return canRun(action, this.status());
  }

  itemIdAt(index: number): string {
    const ctrl = this.receiveForm.controls.items.at(index);
    return ctrl?.controls.returnItemId.value ?? String(index);
  }

  itemLabelAt(index: number): string {
    const items = this.return().items ?? [];
    const item = items[index];
    if (!item) return `Return item ${index + 1}`;
    const resolvedName = pickTranslation(
      item.orderItem?.productName,
      this.authStore.locale(),
      '',
      this.storeSettings.defaultLocale(),
    );
    const name = resolvedName || item.orderItem?.sku || item.id;
    const qty = item.quantity ? ` × ${item.quantity}` : '';
    return `${name}${qty}`;
  }

  rejectError(): string | null {
    const c = this.rejectForm.controls.reason;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Reason is required.';
    if (c.hasError('maxlength')) return 'Reason is limited to 1000 characters.';
    return null;
  }

  refundMethodError(): string | null {
    const c = this.refundForm.controls.refundMethod;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Refund method is required.';
    return null;
  }

  openPanel(kind: Exclude<PanelKind, null>): void {
    if (!this.allowed(kind === 'reject' ? 'reject' : kind === 'receive' ? 'receive' : 'refund')) {
      return;
    }
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    this.panelTrigger = active instanceof HTMLElement ? active : null;
    this.panel.set(kind);
    this.error.set(null);
    if (kind === 'reject') {
      this.rejectForm.reset({ reason: '' });
    }
    if (kind === 'refund') {
      this.refundForm.reset({ refundMethod: 'ORIGINAL_PAYMENT', notes: '' });
    }
    if (kind === 'receive') {
      this.rebuildReceiveForm();
    }
    this.focusFirstInPanel(kind);
  }

  private focusFirstInPanel(kind: Exclude<PanelKind, null>): void {
    const selector =
      kind === 'reject'
        ? '[data-testid="return-reject-panel"] textarea, [data-testid="return-reject-panel"] input'
        : kind === 'receive'
          ? '[data-testid="return-receive-decision-0"]'
          : '[data-testid="return-refund-method"]';
    queueMicrotask(() => {
      const el = this.host.nativeElement.querySelector(selector) as HTMLElement | null;
      el?.focus();
    });
  }

  closePanel(): void {
    const trigger = this.panelTrigger;
    this.panelTrigger = null;
    this.panel.set(null);
    if (trigger && document.contains(trigger)) {
      queueMicrotask(() => trigger.focus());
    }
  }

  private rebuildReceiveForm(): void {
    const items = this.return().items ?? [];
    const arr = this.receiveForm.controls.items;
    arr.clear();
    for (const item of items) {
      arr.push(
        this.fb.nonNullable.group({
          returnItemId: this.fb.nonNullable.control<string>(item.id, [Validators.required]),
          restockDecision: this.fb.nonNullable.control<RestockDecision>(
            item.restockDecision ?? 'RESTOCK',
            [Validators.required],
          ),
          notes: this.fb.nonNullable.control<string>(item.notes ?? '', [Validators.maxLength(500)]),
        }),
      );
    }
  }

  async confirmApprove(): Promise<void> {
    if (this.busy() || !this.allowed('approve')) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Approve this return?',
      body: `Return ${this.return().returnNumber ?? this.return().id} will move from ${this.status()} to APPROVED.`,
      confirmLabel: 'Approve return',
      tone: 'neutral',
    });
    if (!ok) return;

    this.startAction('approve');
    this.returnsService.approve(this.return().id).subscribe({
      next: (updated) => this.finishAction('Return approved', updated),
      error: (err: unknown) => this.failAction(err, 'Could not approve return.'),
    });
  }

  async confirmClose(): Promise<void> {
    if (this.busy() || !this.allowed('close')) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Close this return?',
      body: 'Closing the return finalises its lifecycle. No further actions are available afterwards.',
      confirmLabel: 'Close return',
      tone: 'destructive',
    });
    if (!ok) return;

    this.startAction('close');
    this.returnsService.close(this.return().id).subscribe({
      next: (updated) => this.finishAction('Return closed', updated),
      error: (err: unknown) => this.failAction(err, 'Could not close return.'),
    });
  }

  submitReject(): void {
    this.rejectForm.markAllAsTouched();
    if (this.rejectForm.invalid || this.busy()) return;

    const { reason } = this.rejectForm.getRawValue();
    this.startAction('reject');
    this.returnsService.reject(this.return().id, { reason }).subscribe({
      next: (updated) => {
        this.closePanel();
        this.finishAction('Return rejected', updated);
      },
      error: (err: unknown) => this.failAction(err, 'Could not reject return.'),
    });
  }

  submitReceive(): void {
    if (this.busy()) return;
    if (this.receiveForm.controls.items.length === 0) return;
    this.receiveForm.markAllAsTouched();
    if (this.receiveForm.invalid) return;

    const items = this.receiveForm.controls.items.controls.map((g) => {
      const raw = g.getRawValue();
      const notes = raw.notes.trim();
      return {
        returnItemId: raw.returnItemId,
        restockDecision: raw.restockDecision,
        ...(notes.length > 0 ? { notes } : {}),
      };
    });

    if (items.length === 0) return;

    this.startAction('receive');
    this.returnsService.receive(this.return().id, { items: items as never }).subscribe({
      next: (updated) => {
        this.closePanel();
        this.finishAction('Items received', updated);
      },
      error: (err: unknown) => this.failAction(err, 'Could not record receipt.'),
    });
  }

  submitRefund(): void {
    if (this.busy() || this.refundForm.invalid) return;
    const raw = this.refundForm.getRawValue();
    const notes = raw.notes.trim();
    const payload = {
      refundMethod: raw.refundMethod,
      ...(notes.length > 0 ? { notes } : {}),
    };

    this.startAction('refund');
    this.returnsService.refund(this.return().id, payload).subscribe({
      next: (updated) => {
        this.closePanel();
        this.finishAction('Refund processed', updated);
      },
      error: (err: unknown) => this.failAction(err, 'Could not process refund.'),
    });
  }

  private startAction(kind: ReturnAction): void {
    this.busy.set(true);
    this.action.set(kind);
    this.error.set(null);
    this.lastAction.set(null);
  }

  private finishAction(label: string, updated: Return): void {
    this.busy.set(false);
    this.action.set(null);
    this.lastAction.set(label);
    this.returnChanged.emit(updated);
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.error.set(this.formatError(err, fallback));
    this.lastAction.set('Action failed');
  }

  private formatError(err: unknown, fallback: string): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to run this action.';
    if (err instanceof ApiNotFoundError) return 'Return not found.';
    if (err instanceof ApiConflictError)
      return 'Action rejected. The return is no longer in a compatible state for this transition.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
