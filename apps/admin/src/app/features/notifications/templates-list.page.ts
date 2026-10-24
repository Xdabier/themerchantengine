import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { BadgeComponent, LoadErrorComponent, SkeletonComponent } from '@admin-ui';
import {
  NotificationTemplatesService,
  SettingsService,
  type NotificationTemplate,
} from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

function templateLabel(
  t: Pick<NotificationTemplate, 'subject' | 'code'>,
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    t.subject as Translatable | string | null | undefined,
    locale,
    t.code,
    defaultLocale,
  );
}

interface DomainDef {
  readonly key: string;
  readonly label: string;
  readonly match: (t: NotificationTemplate) => boolean;
}

// First match wins; the trailing Ops bucket catches everything else.
const DOMAINS: readonly DomainDef[] = [
  {
    key: 'auth',
    label: 'Account & Auth',
    // `admin.` as a prefix swallowed the weekly/daily operational digests;
    // only the staff invite is genuinely an account flow (finding E17).
    match: (t) =>
      t.code.startsWith('auth.') ||
      t.code.startsWith('customer.') ||
      t.code === 'admin.staff-invite',
  },
  { key: 'orders', label: 'Orders', match: (t) => t.code.startsWith('order.') },
  { key: 'giftcards', label: 'Gift cards', match: (t) => t.code.startsWith('giftcard.') },
  { key: 'returns', label: 'Returns', match: (t) => t.code.startsWith('return.') },
  {
    key: 'reviews',
    label: 'Reviews & Q&A',
    match: (t) => t.code.startsWith('review.') || t.code.startsWith('question.'),
  },
  {
    key: 'lifecycle',
    label: 'Lifecycle',
    match: (t) => t.code.startsWith('cart.') || t.category === 'LIFECYCLE',
  },
  { key: 'marketing', label: 'Marketing', match: (t) => t.category === 'MARKETING' },
  { key: 'ops', label: 'Ops & Support', match: () => true },
];

interface DomainGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly NotificationTemplate[];
}

/**
 * `/notifications/templates` — the per-flow "Notifications & Email" control
 * matrix. Every triggered email grouped by domain with a send toggle (locked
 * security/legal flows are read-only) + a global "pause all email" switch. Row
 * "Edit" opens the template editor.
 */
@Component({
  selector: 'app-templates-list-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, LoadErrorComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="templates-list-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Marketing</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Notification templates</h1>
          <p class="mt-3 tabular text-sm text-ink-muted max-w-xl">
            Every triggered email, grouped by domain. Turn a flow off to stop it sending — the
            template stays saved. Security &amp; legal flows are always on.
          </p>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <a
            routerLink="/notifications/log"
            class="inline-flex h-10 items-center border border-line px-4 text-xs tracking-widest uppercase text-ink-muted hover:border-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            data-testid="templates-go-to-log"
          >
            Send log
          </a>
          @if (canManage()) {
            <a
              routerLink="/notifications/templates/new"
              class="inline-flex h-10 items-center bg-surface-emphasis text-on-emphasis px-4 text-xs tracking-widest uppercase hover:bg-surface-emphasis-hover focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="templates-new"
            >
              New template
            </a>
          }
        </div>
      </header>

      <div role="alert" data-testid="templates-list-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <!-- Global pause -->
      <div
        class="border border-line bg-surface p-5 flex items-start justify-between gap-6 flex-wrap"
      >
        <div class="min-w-0">
          <h2 class="text-xs tracking-widest uppercase text-ink-muted">Pause all email</h2>
          <p class="mt-2 text-sm text-ink max-w-xl">
            Stops every flow from sending — except security &amp; legal flows (password reset, order
            &amp; refund confirmations), which always send.
          </p>
          <p class="mt-1 text-xs tabular text-ink-muted">Takes up to ~30 seconds to apply.</p>
        </div>
        <label class="inline-flex items-center gap-3 text-sm tabular shrink-0">
          <span class="sr-only">Pause all email</span>
          <input
            type="checkbox"
            class="h-5 w-5 accent-ink"
            [checked]="pauseAll()"
            [disabled]="!canManage() || pauseBusy() || loading()"
            (change)="togglePause($event)"
            data-testid="templates-pause-all"
            [attr.aria-busy]="pauseBusy() ? 'true' : null"
          />
          <span [class.text-status-warning]="pauseAll()">
            {{ pauseAll() ? 'Paused' : 'Active' }}
          </span>
        </label>
      </div>

      @if (pauseError()) {
        <app-load-error
          [message]="pauseError()!"
          [compact]="true"
          [retrying]="pauseLoading()"
          retryLabel="pause state"
          testId="templates-pause-degraded"
          (retry)="fetchPause()"
        />
      }

      @if (loading()) {
        <div class="border border-line bg-surface p-5 flex flex-col gap-3">
          @for (_ of [0, 1, 2, 3, 4]; track $index) {
            <app-skeleton height="1.5rem" width="100%" />
          }
        </div>
      } @else {
        @for (group of groups(); track group.key) {
          <div
            class="border border-line bg-surface"
            [attr.data-testid]="'templates-group-' + group.key"
          >
            <h2
              class="text-xs tracking-widest uppercase text-ink-muted px-4 py-3 border-b border-line"
            >
              {{ group.label }}
            </h2>
            <div class="overflow-x-auto">
              <table class="w-full border-collapse">
                <caption class="sr-only">
                  {{
                    group.label
                  }}
                  email flows
                </caption>
                <thead class="border-b border-line">
                  <tr class="text-start">
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-2"
                    >
                      Flow
                    </th>
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-2"
                    >
                      Class
                    </th>
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-2"
                    >
                      Sends
                    </th>
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-2"
                    >
                      <span class="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of group.rows; track t.id) {
                    <tr
                      class="border-b border-line last:border-b-0 hover:bg-surface-elevated"
                      [attr.data-testid]="'templates-row-' + t.id"
                    >
                      <td class="px-4 py-3">
                        <span class="tabular text-sm text-ink">{{ label(t) }}</span>
                        <p class="text-xs font-mono text-ink-muted mt-1">{{ t.code }}</p>
                      </td>
                      <td class="px-4 py-3">
                        <app-badge
                          [tone]="t.category === 'MARKETING' ? 'warning' : 'neutral'"
                          [ariaLabel]="t.category ?? 'TRANSACTIONAL'"
                        >
                          {{ classLabel(t.category) }}
                        </app-badge>
                      </td>
                      <td class="px-4 py-3">
                        @if (t.isLocked) {
                          <span
                            class="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-ink-muted"
                            [attr.data-testid]="'templates-locked-' + t.id"
                          >
                            <app-badge tone="info" ariaLabel="Always on — locked"
                              >Always on</app-badge
                            >
                          </span>
                        } @else {
                          <label class="inline-flex items-center gap-3 text-sm tabular">
                            <span class="sr-only">{{ 'Send ' + label(t) }}</span>
                            <input
                              type="checkbox"
                              class="h-4 w-4 accent-ink"
                              [checked]="t.sendEnabled !== false"
                              [disabled]="!canManage() || rowBusy() === t.id"
                              (change)="toggleSend(t, $event)"
                              [attr.data-testid]="'templates-toggle-' + t.id"
                              [attr.aria-busy]="rowBusy() === t.id ? 'true' : null"
                            />
                            <span [class.text-ink-muted]="t.sendEnabled === false">
                              {{ t.sendEnabled !== false ? 'On' : 'Off' }}
                            </span>
                          </label>
                        }
                      </td>
                      <td class="px-4 py-3 text-end">
                        <a
                          [routerLink]="['/notifications/templates', t.id]"
                          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                          [attr.data-testid]="'templates-edit-' + t.id"
                        >
                          Edit template
                        </a>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        } @empty {
          <div
            class="border border-line bg-surface px-4 py-16 text-center text-ink-muted tabular text-sm"
            data-testid="templates-empty"
          >
            No email flows configured.
          </div>
        }
      }
    </section>
  `,
})
export class TemplatesListPage implements OnInit, OnDestroy {
  private readonly service = inject(NotificationTemplatesService);
  private readonly settings = inject(SettingsService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  protected readonly label = (t: Pick<NotificationTemplate, 'subject' | 'code'>): string =>
    templateLabel(t, this.authStore.locale(), this.storeSettings.defaultLocale());

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly NotificationTemplate[]>([]);
  readonly pauseAll = signal(false);
  readonly pauseError = signal<string | null>(null);
  readonly pauseLoading = signal(false);
  readonly pauseBusy = signal(false);
  readonly rowBusy = signal<string | null>(null);

  readonly canManage = computed(() => this.authStore.hasAnyPermission(['notifications:manage']));

  readonly groups = computed<readonly DomainGroup[]>(() => {
    const buckets = new Map<string, NotificationTemplate[]>();
    for (const t of this.rows()) {
      const domain = DOMAINS.find((d) => d.match(t)) ?? DOMAINS[DOMAINS.length - 1];
      const list = buckets.get(domain.key) ?? [];
      list.push(t);
      buckets.set(domain.key, list);
    }
    return DOMAINS.filter((d) => buckets.has(d.key)).map((d) => ({
      key: d.key,
      label: d.label,
      rows: (buckets.get(d.key) ?? []).sort((a, b) => a.code.localeCompare(b.code)),
    }));
  });

  classLabel(category: string | undefined): string {
    switch (category) {
      case 'MARKETING':
        return 'Marketing';
      case 'LIFECYCLE':
        return 'Lifecycle';
      default:
        return 'Transactional';
    }
  }

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleSend(t: NotificationTemplate, event: Event): void {
    if (!this.canManage() || this.rowBusy()) return;
    const next = (event.target as HTMLInputElement).checked;
    this.rowBusy.set(t.id);
    this.error.set(null);
    // Optimistic flip.
    this.patchRow(t.id, { sendEnabled: next });
    this.service
      .updateTemplate(t.id, { sendEnabled: next })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updated) => {
          this.patchRow(t.id, { sendEnabled: updated.sendEnabled });
          this.rowBusy.set(null);
        },
        error: (err: unknown) => {
          this.patchRow(t.id, { sendEnabled: !next }); // revert
          this.rowBusy.set(null);
          this.error.set(this.formatError(err, 'Could not update the flow.'));
        },
      });
  }

  togglePause(event: Event): void {
    if (!this.canManage() || this.pauseBusy()) return;
    const next = (event.target as HTMLInputElement).checked;
    this.pauseBusy.set(true);
    this.error.set(null);
    this.pauseAll.set(next); // optimistic
    this.settings
      .update({ pauseAll: next })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.pauseAll.set(this.readPause(res));
          this.pauseBusy.set(false);
        },
        error: (err: unknown) => {
          this.pauseAll.set(!next); // revert
          this.pauseBusy.set(false);
          this.error.set(this.formatError(err, 'Could not update the global pause.'));
        },
      });
  }

  private patchRow(id: string, patch: Partial<NotificationTemplate>): void {
    this.rows.set(this.rows().map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  private readPause(res: Record<string, Record<string, unknown>>): boolean {
    return Boolean(res?.['notifications']?.['pauseAll']);
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    // One page covers the full flow catalogue (well under 100 flows).
    this.service
      .listTemplates({ page: 1, pageSize: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
    this.fetchPause();
  }

  /**
   * A read failure must not blank the matrix, but the toggle would otherwise
   * read "Active" while email is in fact paused.
   */
  fetchPause(): void {
    this.pauseLoading.set(true);
    this.settings
      .getAll()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.pauseAll.set(this.readPause(res));
          this.pauseError.set(null);
          this.pauseLoading.set(false);
        },
        error: () => {
          this.pauseError.set('Could not read the global pause state.');
          this.pauseLoading.set(false);
        },
      });
  }

  private formatError(err: unknown, fallback = 'Could not load email flows.'): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view notification templates.';
    if (err instanceof ApiError) return err.message;
    return fallback;
  }
}
