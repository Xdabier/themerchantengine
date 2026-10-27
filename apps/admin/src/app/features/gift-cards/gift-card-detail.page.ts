import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent, openConfirmDialog } from '@admin-ui';
import { GiftCardsService, type GiftCard, type GiftCardTransaction } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  AdjustBalanceDialogComponent,
  type AdjustBalanceDialogData,
  type AdjustBalanceDialogResult,
} from './adjust-balance-dialog.component';
import {
  formatExpiry,
  formatGiftCardMoney,
  giftCardStatus,
  giftCardStatusTone,
} from './gift-cards.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';

/**
 * `/gift-cards/:id` — gift-card detail + ledger.
 *
 * The backend response includes a `transactions` array (credits/debits)
 * rendered newest-first. Three mutations are wired:
 *   - `PATCH { isActive }` behind a confirm dialog (activate/deactivate).
 *   - `POST /:id/adjust` via a side-panel dialog (credit or debit with a
 *     mandatory reason). Responds with the full card + ledger so the
 *     page updates in place without a refetch.
 *   - `POST /:id/resend` — re-queue the redemption email, fire-and-
 *     forget. Surfaces the outcome in a live-region banner.
 */
@Component({
  selector: 'app-gift-card-detail-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, AdminDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="gift-card-detail-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/gift-cards"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Gift cards
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink font-mono" aria-current="page">
          {{ current()?.code ?? '…' }}
        </span>
      </nav>

      <div role="alert" data-testid="gift-card-detail-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading gift card"
          class="flex flex-col gap-4"
        >
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="8rem" width="100%" />
        </div>
      } @else if (current(); as card) {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">Gift card</p>
            <h1 class="mt-2 text-3xl md:text-4xl font-mono tracking-tight truncate">
              {{ card.code }}
            </h1>
            <p class="mt-3 text-sm text-ink-muted">Issued {{ card.createdAt | adminDate }}</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <app-badge
              [tone]="statusTone(computedStatus(card))"
              [ariaLabel]="'Status: ' + computedStatus(card)"
            >
              {{ computedStatus(card) }}
            </app-badge>
            @if (canManage() && card.isActive) {
              <app-button
                variant="secondary"
                size="sm"
                [disabled]="busy()"
                (clicked)="openAdjustDialog()"
                data-testid="gift-card-adjust"
              >
                Adjust balance
              </app-button>
              @if (card.recipientEmail) {
                <app-button
                  variant="secondary"
                  size="sm"
                  [disabled]="busy()"
                  [loading]="busy() && action() === 'resend'"
                  (clicked)="resend()"
                  data-testid="gift-card-resend"
                >
                  Resend email
                </app-button>
              }
              <app-button
                variant="destructive"
                size="sm"
                [disabled]="busy()"
                [loading]="busy() && action() === 'deactivate'"
                (clicked)="deactivate()"
                data-testid="gift-card-deactivate"
              >
                Deactivate
              </app-button>
            } @else if (canManage() && !card.isActive) {
              <app-button
                variant="primary"
                size="sm"
                [disabled]="busy()"
                [loading]="busy() && action() === 'reactivate'"
                (clicked)="reactivate()"
                data-testid="gift-card-reactivate"
              >
                Reactivate
              </app-button>
            }
          </div>
        </header>

        <div role="status" aria-live="polite" aria-atomic="true" data-testid="gift-card-notice">
          @if (notice()) {
            <p class="border border-status-success text-ink p-3 text-xs">
              {{ notice() }}
            </p>
          }
        </div>

        <dl
          class="grid grid-cols-1 md:grid-cols-4 gap-6 border border-line p-5"
          aria-label="Gift card summary"
        >
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Balance</dt>
            <dd class="mt-1 text-2xl font-bold tabular-nums text-ink">
              {{ money(card.currentBalance, card.currency) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Initial</dt>
            <dd class="mt-1 text-sm text-ink tabular-nums">
              {{ money(card.initialBalance, card.currency) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Expires</dt>
            <dd class="mt-1 text-sm text-ink">
              {{ expiry(card.expiresAt) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Recipient</dt>
            <dd class="mt-1 text-sm text-ink">
              {{ card.recipientEmail ?? '—' }}
            </dd>
          </div>
        </dl>

        <section aria-labelledby="timeline-heading">
          <header class="flex items-end justify-between mb-3">
            <h2 id="timeline-heading" class="text-xs tracking-widest uppercase text-ink-muted">
              Ledger
            </h2>
            <p class="text-xs text-ink-muted">
              {{ card.transactions?.length ?? 0 }}
              {{ (card.transactions?.length ?? 0) === 1 ? 'entry' : 'entries' }}
            </p>
          </header>
          <div class="border border-line bg-surface">
            @if (!card.transactions || card.transactions.length === 0) {
              <p class="p-5 text-sm text-ink-muted">
                No transactions yet. Debits land here when the card is redeemed.
              </p>
            } @else {
              <ul role="list" class="divide-y divide-line" data-testid="gift-card-ledger">
                @for (tx of sortedTransactions(); track tx.id) {
                  <li class="flex items-center justify-between px-4 py-3">
                    <div class="flex flex-col">
                      <span class="text-xs tracking-widest uppercase text-ink-muted">
                        {{ tx.note ?? '—' }}
                      </span>
                      <span class="text-xs text-ink-muted mt-1">
                        {{ tx.createdAt | adminDate }}
                      </span>
                    </div>
                    <span
                      class="tabular-nums text-sm text-ink"
                      [class.font-bold]="Number(tx.amount) !== 0"
                    >
                      <span class="sr-only">
                        @if (Number(tx.amount) > 0) {
                          Credit:
                        } @else if (Number(tx.amount) < 0) {
                          Debit:
                        } @else {
                          Zero:
                        }
                      </span>
                      <span aria-hidden="true">{{ Number(tx.amount) > 0 ? '+' : '' }}</span>
                      {{ money(tx.amount, card.currency) }}
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        </section>
      }
    </section>
  `,
})
export class GiftCardDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(GiftCardsService);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(Dialog);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<GiftCard | null>(null);
  readonly busy = signal(false);
  readonly action = signal<'deactivate' | 'reactivate' | 'resend' | null>(null);
  readonly notice = signal<string | null>(null);

  readonly canManage = computed(() => this.authStore.hasPermission('gift_cards:update'));

  readonly sortedTransactions = computed<readonly GiftCardTransaction[]>(() => {
    const txs = this.current()?.transactions ?? [];
    return [...txs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  });

  protected readonly Number = Number;
  protected readonly money = formatGiftCardMoney;
  protected readonly expiry = formatExpiry;
  protected readonly computedStatus = giftCardStatus;
  protected readonly statusTone = giftCardStatusTone;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (id) this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async deactivate(): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Deactivate this gift card?',
      body: 'The card will stop redeeming immediately. You can reactivate it later.',
      confirmLabel: 'Deactivate',
      tone: 'destructive',
    });
    if (ok) this.patchActive('deactivate', false);
  }

  async reactivate(): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Reactivate this gift card?',
      body: 'The card will accept redemption again.',
      confirmLabel: 'Reactivate',
    });
    if (ok) this.patchActive('reactivate', true);
  }

  async openAdjustDialog(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;
    const ref = this.dialog.open<AdjustBalanceDialogResult, AdjustBalanceDialogData>(
      AdjustBalanceDialogComponent,
      {
        hasBackdrop: true,
        panelClass: 'side-panel-right',
        backdropClass: 'cdk-overlay-backdrop-brand',
        // CDK's <cdk-dialog-container> already renders role="dialog" +
        // aria-modal="true" — we only need to name it. The inner template
        // provides visual title + description; those ids are not useful
        // to the container (they render after construction), so pass a
        // stable label string instead of aria-labelledby.
        ariaLabel: 'Adjust gift card balance',
        data: {
          giftCardId: current.id,
          currency: current.currency,
          currentBalance: Number(current.currentBalance),
        },
      },
    );
    const result = await new Promise<AdjustBalanceDialogResult>((resolve) => {
      ref.closed.subscribe((v) => resolve((v as AdjustBalanceDialogResult) ?? null));
    });
    if (result?.kind === 'saved') {
      this.current.set(result.card);
      this.flashNotice('Balance updated — the ledger reflects the new entry.');
    }
  }

  resend(): void {
    const current = this.current();
    if (!current || !current.recipientEmail || this.busy()) return;
    this.busy.set(true);
    this.action.set('resend');
    this.error.set(null);
    this.service.resendEmail(current.id).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.action.set(null);
        this.flashNotice(`Redemption email re-queued to ${res.recipientEmail}.`);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.action.set(null);
        this.error.set(this.formatError(err));
      },
    });
  }

  private patchActive(action: 'deactivate' | 'reactivate', isActive: boolean): void {
    const current = this.current();
    if (!current || this.busy()) return;
    this.busy.set(true);
    this.action.set(action);
    this.error.set(null);
    this.service.update(current.id, { isActive }).subscribe({
      next: (updated) => {
        this.current.set(updated);
        this.busy.set(false);
        this.action.set(null);
        // After the flip, Angular destroys the triggering button and renders
        // the opposite variant in its place; CDK Dialog tries to restore
        // focus to the now-unmounted trigger, so the focus silently falls
        // to <body>. Move it to the replacement button after the next
        // render so keyboard users stay in the same action region.
        const replacementTestId =
          action === 'deactivate' ? 'gift-card-reactivate' : 'gift-card-deactivate';
        afterNextRender(
          () => {
            const el = this.host.nativeElement.querySelector<HTMLElement>(
              `[data-testid="${replacementTestId}"]`,
            );
            el?.focus();
          },
          { injector: this.injector },
        );
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.action.set(null);
        this.error.set(this.formatError(err));
      },
    });
  }

  private flashNotice(message: string): void {
    this.notice.set(message);
    setTimeout(() => this.notice.set(null), 4000);
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (card) => {
          this.current.set(card);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiNotFoundError) return 'Gift card not found.';
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view this gift card.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load gift card. Please retry.';
  }
}
