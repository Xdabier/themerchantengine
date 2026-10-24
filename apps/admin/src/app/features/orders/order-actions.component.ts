import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  TextareaComponent,
  openConfirmDialog,
} from '@admin-ui';
import { OrdersService, type Order, type OrderStatus } from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { canCancelOrder, manualStatusOptions, orderStatusLabel } from './orders.utils';

type ActionKind = 'status' | 'cancel' | 'note';

/**
 * Order mutation actions: status change, cancel, internal note.
 *
 * Gating
 * - `canManage` input reflects `orders:manage` permission from the parent;
 *   the component stays read-only when false and emits nothing.
 *
 * Concurrency
 * - One action at a time via `busy` signal. The status dropdown + cancel
 *   button + note submit all disable each other so a slow network can't
 *   stack conflicting writes.
 *
 * Parent handshake
 * - On success, emits `orderChanged` with the returned Order so the detail
 *   page can refresh its local signal without a round-trip refetch.
 */
@Component({
  selector: 'app-order-actions',
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
        data-testid="order-actions"
        aria-labelledby="order-actions-heading"
      >
        <header class="px-5 py-4 border-b border-line flex items-center justify-between">
          <h2 id="order-actions-heading" class="text-xs tracking-widest uppercase text-ink-muted">
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

        <div class="p-5 flex flex-col gap-6">
          @if (error()) {
            <p
              class="border border-status-error text-ink p-3 tabular text-xs"
              data-testid="order-action-error"
              role="alert"
            >
              {{ error() }}
            </p>
          }

          @if (statusOptions().length > 1) {
            <div class="flex flex-col sm:flex-row sm:items-end gap-3">
              <div class="flex-1">
                <label
                  for="order-status-select"
                  class="block text-xs tracking-widest uppercase text-ink-muted mb-2"
                >
                  Change status
                </label>
                <select
                  id="order-status-select"
                  class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 disabled:bg-surface-elevated disabled:text-ink-muted disabled:cursor-not-allowed"
                  [disabled]="busy()"
                  (change)="onStatusPicked($event)"
                  data-testid="order-status-select"
                >
                  @for (opt of statusOptions(); track opt) {
                    <option [value]="opt" [selected]="opt === pendingStatus()">
                      {{ orderStatusLabel(opt) }}
                    </option>
                  }
                </select>
              </div>
              <app-button
                variant="primary"
                size="md"
                [disabled]="!statusDirty() || busy()"
                [loading]="busy() && action() === 'status'"
                (clicked)="confirmStatusChange()"
                data-testid="order-status-submit"
              >
                Apply
              </app-button>
            </div>
          } @else {
            <p class="tabular text-xs text-ink-muted" data-testid="order-status-terminal">
              Terminal state: {{ orderStatusLabel(order().status) }} orders accept no further status
              change.
            </p>
          }

          <form
            [formGroup]="noteForm"
            (ngSubmit)="addNote()"
            class="flex flex-col gap-3"
            novalidate
          >
            <app-form-field
              label="Internal note"
              fieldId="order-note"
              [error]="noteError()"
              [hint]="'Visible to staff only — never emailed to the customer.'"
            >
              <app-textarea
                id="order-note"
                formControlName="note"
                [rows]="3"
                [invalid]="!!noteError()"
              ></app-textarea>
            </app-form-field>
            <div class="flex justify-end">
              <app-button
                type="submit"
                variant="secondary"
                size="sm"
                [disabled]="noteForm.invalid || busy()"
                [loading]="busy() && action() === 'note'"
                data-testid="order-note-submit"
              >
                Add note
              </app-button>
            </div>
          </form>

          <div class="border-t border-line pt-5 flex items-center justify-between gap-3">
            <p class="text-xs tabular text-ink-muted">{{ cancelCaption() }}</p>
            @if (canCancel()) {
              <app-button
                variant="destructive"
                size="sm"
                [disabled]="busy()"
                [loading]="busy() && action() === 'cancel'"
                (clicked)="confirmCancel()"
                data-testid="order-cancel"
              >
                Cancel order
              </app-button>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class OrderActionsComponent {
  private readonly ordersService = inject(OrdersService);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);

  readonly order = input.required<Order>();
  readonly canManage = input<boolean>(false);
  readonly orderChanged = output<Order>();

  readonly busy = signal(false);
  readonly action = signal<ActionKind | null>(null);
  readonly error = signal<string | null>(null);
  readonly lastAction = signal<string | null>(null);
  readonly pendingStatus = signal<OrderStatus | null>(null);

  readonly noteForm = this.fb.nonNullable.group({
    note: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(2000)]],
  });

  /** Derived from the backend state machine, so no illegal move is offered. */
  readonly statusOptions = computed(() => manualStatusOptions(this.order().status));
  readonly canCancel = computed(() => canCancelOrder(this.order().status));

  protected readonly orderStatusLabel = orderStatusLabel;

  readonly statusDirty = computed(
    () => this.pendingStatus() !== null && this.pendingStatus() !== this.order().status,
  );
  readonly isCancelled = computed(() => this.order().status === 'CANCELLED');

  /** States the reason instead of leaving a dead red button on screen. */
  readonly cancelCaption = computed(() =>
    this.canCancel()
      ? 'Cancelling an order is irreversible from this screen.'
      : `${orderStatusLabel(this.order().status)} orders can no longer be cancelled.`,
  );

  constructor() {
    // Seed the picker from the order; must run after `order` is bound.
    queueMicrotask(() => this.pendingStatus.set(this.order().status));
  }

  noteError(): string | null {
    const c = this.noteForm.controls.note;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Write something before adding the note.';
    if (c.hasError('maxlength')) return 'Notes are limited to 2000 characters.';
    return null;
  }

  onStatusPicked(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as OrderStatus;
    this.pendingStatus.set(value);
  }

  async confirmStatusChange(): Promise<void> {
    const next = this.pendingStatus();
    if (!next || next === this.order().status || this.busy()) return;

    const ok = await openConfirmDialog(this.dialog, {
      title: `Change status to ${next}?`,
      body: `Order ${this.order().orderNumber ?? this.order().id} will move from ${this.order().status} to ${next}.`,
      confirmLabel: 'Change status',
      tone: 'neutral',
    });
    if (!ok) return;

    this.startAction('status');
    this.ordersService.updateStatus(this.order().id, { status: next }).subscribe({
      next: (updated) => this.finishAction('Status updated', updated),
      error: (err: unknown) => this.failAction(err, 'Could not update status.'),
    });
  }

  async confirmCancel(): Promise<void> {
    if (this.busy() || !this.canCancel()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Cancel this order?',
      body: 'Cancellation is irreversible from this screen. Any pending fulfilment or payment capture will be aborted server-side.',
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
      tone: 'destructive',
    });
    if (!ok) return;

    this.startAction('cancel');
    this.ordersService.updateStatus(this.order().id, { status: 'CANCELLED' }).subscribe({
      next: (updated) => this.finishAction('Order cancelled', updated),
      error: (err: unknown) => this.failAction(err, 'Could not cancel order.'),
    });
  }

  addNote(): void {
    this.noteForm.markAllAsTouched();
    if (this.noteForm.invalid || this.busy()) return;

    const { note } = this.noteForm.getRawValue();
    this.startAction('note');
    this.ordersService.addNote(this.order().id, { note }).subscribe({
      next: () => {
        this.noteForm.reset({ note: '' });
        // Backend returns the note (not the order) — bump the parent so any
        // History tab re-fetches on the next tick. We don't mutate the order
        // locally because `notes` shape is not guaranteed by the contract.
        this.finishAction('Note added', this.order());
      },
      error: (err: unknown) => this.failAction(err, 'Could not add note.'),
    });
  }

  private startAction(kind: ActionKind): void {
    this.busy.set(true);
    this.action.set(kind);
    this.error.set(null);
    this.lastAction.set(null);
  }

  private finishAction(label: string, updated: Order): void {
    this.busy.set(false);
    this.action.set(null);
    this.lastAction.set(label);
    this.orderChanged.emit(updated);
    this.pendingStatus.set(updated.status);
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.error.set(this.formatError(err, fallback));
    this.lastAction.set('Action failed');
  }

  private formatError(err: unknown, fallback: string): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to run this action.';
    if (err instanceof ApiNotFoundError) return 'Order not found.';
    if (err instanceof ApiConflictError)
      return 'Status change rejected. The order is already in a terminal state.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
