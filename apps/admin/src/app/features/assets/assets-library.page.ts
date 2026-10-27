import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  DropzoneComponent,
  PaginationComponent,
  SkeletonComponent,
  type DropzoneFileRejection,
} from '@admin-ui';
import {
  AssetsService,
  type Asset,
  type AssetStatus,
  type AssetType,
  type ListAssetsQuery,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, Subscription, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  assetAltText,
  assetStatusLabel,
  assetStatusTone,
  assetTypeLabel,
  bytesOf,
  formatBytes,
  isImage,
  isVideo,
} from './assets.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

export type MediaQueueStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'STILL_PROCESSING' | 'FAILED';

export interface MediaQueueRow {
  tempId: string;
  file: File;
  progress: number;
  status: MediaQueueStatus;
  assetId?: string;
  error?: string;
}

const MAX_CONCURRENT_UPLOADS = 8;
const POLL_INTERVAL_MS = 1_000;
const POLL_CAP_MS = 30_000;
const READY_AUTO_CLEAR_MS = 5_000;

/**
 * `/assets` — media library.
 *
 * Drop files at the top of the page to upload; browse the existing
 * library below. Grid layout by default (thumbnails), switchable to
 * list via a compact toggle. URL owns page + pageSize + type + status
 * so deep-links are shareable. The transient upload queue lives only
 * in this signal — refresh wipes it; the underlying grid refetches
 * once every batch settles so authoritative state always shows there.
 */
@Component({
  selector: 'app-assets-library-page',
  standalone: true,
  imports: [
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    DropzoneComponent,
    SkeletonComponent,
    AdminDatePipe,
    PaginationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="assets-library-page">
      <header class="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">Media</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Assets</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Every uploaded image + video. Drop files below to add new media.
          </p>
        </div>
        <div
          class="flex items-center gap-2"
          role="group"
          aria-label="Toggle view mode"
          data-testid="assets-view-toggle"
        >
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="view() === 'grid'"
            [class.text-ink]="view() === 'grid'"
            [class.border-line]="view() !== 'grid'"
            [class.text-ink-muted]="view() !== 'grid'"
            [attr.aria-pressed]="view() === 'grid'"
            (click)="setView('grid')"
            data-testid="assets-view-grid"
          >
            Grid
          </button>
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="view() === 'list'"
            [class.text-ink]="view() === 'list'"
            [class.border-line]="view() !== 'list'"
            [class.text-ink-muted]="view() !== 'list'"
            [attr.aria-pressed]="view() === 'list'"
            (click)="setView('list')"
            data-testid="assets-view-list"
          >
            List
          </button>
        </div>
      </header>

      @if (canUpload()) {
        <div class="flex flex-col gap-4" data-testid="assets-upload-block">
          <app-dropzone
            [multiple]="true"
            [busy]="hasInFlight()"
            (filesAdded)="onFilesAdded($event)"
            (filesRejected)="onFilesRejected($event)"
            testId="assets-dropzone"
          />

          @if (mediaQueue().length > 0) {
            <ul
              class="flex flex-col gap-2 border border-line p-3"
              role="list"
              aria-label="Upload queue"
              [attr.aria-busy]="hasInFlight() ? 'true' : null"
              data-testid="assets-upload-queue"
            >
              @for (row of mediaQueue(); track row.tempId) {
                <li
                  class="flex flex-col gap-2 border border-line p-3 bg-surface"
                  [attr.aria-busy]="
                    row.status === 'UPLOADING' || row.status === 'PROCESSING' ? 'true' : null
                  "
                  [attr.data-testid]="'assets-upload-row-' + row.tempId"
                  [attr.data-asset-id]="row.assetId ?? null"
                >
                  <div class="flex items-center justify-between gap-3 flex-wrap">
                    <p
                      class="text-sm text-ink truncate min-w-0"
                      [title]="row.file.name"
                      [attr.data-testid]="'assets-upload-name-' + row.tempId"
                    >
                      {{ row.file.name }}
                    </p>
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs tabular-nums text-ink-muted">
                        {{ formatBytes(row.file.size) }}
                      </span>
                      <app-badge
                        [tone]="queueTone(row.status)"
                        [ariaLabel]="'Status: ' + queueLabel(row.status)"
                        [attr.data-testid]="'assets-upload-status-' + row.tempId"
                      >
                        {{ queueLabel(row.status) }}
                      </app-badge>
                    </div>
                  </div>

                  @if (row.status === 'UPLOADING') {
                    <div
                      role="progressbar"
                      [attr.aria-valuenow]="row.progress"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      [attr.aria-label]="'Upload progress for ' + row.file.name"
                      class="h-1 bg-surface-elevated overflow-hidden"
                      [attr.data-testid]="'assets-upload-progress-' + row.tempId"
                    >
                      <div
                        class="h-full bg-surface-emphasis"
                        [style.inline-size.%]="row.progress"
                      ></div>
                    </div>
                  }

                  @if (row.error) {
                    <p
                      class="text-xs text-ink"
                      [attr.data-testid]="'assets-upload-error-' + row.tempId"
                    >
                      {{ row.error }}
                    </p>
                  }

                  <div class="flex items-center gap-2 flex-wrap">
                    @if (row.status === 'FAILED') {
                      <app-button
                        variant="secondary"
                        size="sm"
                        [ariaLabel]="'Retry upload for ' + row.file.name"
                        (clicked)="retry(row.tempId)"
                        [attr.data-testid]="'assets-upload-retry-' + row.tempId"
                      >
                        Retry
                      </app-button>
                    }
                    @if (row.status === 'STILL_PROCESSING' && row.assetId) {
                      <a
                        [routerLink]="['/assets', row.assetId]"
                        class="text-xs tracking-widest uppercase px-3 py-2 min-h-11 inline-flex items-center border border-line hover:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 text-ink"
                        [attr.aria-label]="'View ' + row.file.name + ' in library'"
                        [attr.data-testid]="'assets-upload-view-' + row.tempId"
                      >
                        View in library
                      </a>
                    }
                    <app-button
                      variant="secondary"
                      size="sm"
                      [ariaLabel]="'Dismiss ' + row.file.name"
                      (clicked)="dismiss(row.tempId)"
                      [attr.data-testid]="'assets-upload-dismiss-' + row.tempId"
                    >
                      Dismiss
                    </app-button>
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      }

      <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by type">
        @for (opt of typeOptions; track opt.value) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="typeFilter() === opt.value"
            [class.text-ink]="typeFilter() === opt.value"
            [class.border-line]="typeFilter() !== opt.value"
            [class.text-ink-muted]="typeFilter() !== opt.value"
            [attr.aria-pressed]="typeFilter() === opt.value"
            [attr.data-testid]="'assets-type-' + (opt.value ?? 'all')"
            (click)="setType(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by status">
        @for (opt of statusOptions; track opt.value) {
          <button
            type="button"
            class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            [class.border-ink]="statusFilter() === opt.value"
            [class.text-ink]="statusFilter() === opt.value"
            [class.border-line]="statusFilter() !== opt.value"
            [class.text-ink-muted]="statusFilter() !== opt.value"
            [attr.aria-pressed]="statusFilter() === opt.value"
            [attr.data-testid]="'assets-status-' + (opt.value ?? 'all')"
            (click)="setStatus(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="assets-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          @for (_ of placeholderRows; track $index) {
            <app-skeleton height="10rem" width="100%" />
          }
        </div>
      } @else if (rows().length === 0) {
        <p class="text-sm text-ink-muted text-center py-16">No assets match the current filters.</p>
      } @else if (view() === 'grid') {
        <ul
          class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
          role="list"
          data-testid="assets-grid"
        >
          @for (a of rows(); track a.id) {
            <li>
              <a
                [routerLink]="['/assets', a.id]"
                class="block border border-line hover:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                [attr.data-testid]="'asset-card-' + a.id"
              >
                <div class="aspect-square bg-surface-elevated overflow-hidden">
                  @if (image(a) && thumbSrc(a); as src) {
                    <img
                      [src]="src"
                      [alt]="altText(a) || 'Asset ' + a.id"
                      class="w-full h-full object-cover"
                    />
                  } @else if (image(a)) {
                    <div
                      class="w-full h-full flex items-center justify-center text-xs tracking-widest uppercase text-ink-muted"
                      [attr.data-testid]="'asset-card-pending-' + a.id"
                    >
                      {{ statusLabel(a.status) }}
                    </div>
                  } @else if (video(a)) {
                    <div
                      class="w-full h-full flex items-center justify-center text-xs tracking-widest uppercase text-ink-muted"
                    >
                      Video
                    </div>
                  } @else {
                    <div
                      class="w-full h-full flex items-center justify-center text-xs tracking-widest uppercase text-ink-muted"
                    >
                      {{ typeLabel(a.type) }}
                    </div>
                  }
                </div>
                <div class="p-3 flex flex-col gap-1">
                  <p class="text-xs text-ink-muted truncate" [title]="a.id">
                    {{ altText(a) || a.id }}
                  </p>
                  <div class="flex items-center gap-2 flex-wrap">
                    <app-badge
                      [tone]="statusTone(a.status)"
                      [ariaLabel]="'Status: ' + statusLabel(a.status)"
                    >
                      {{ statusLabel(a.status) }}
                    </app-badge>
                    <span class="font-mono text-xs tabular-nums text-ink-muted">
                      {{ formatBytes(bytesOf(a)) }}
                    </span>
                  </div>
                </div>
              </a>
            </li>
          }
        </ul>
      } @else {
        <div class="border border-line bg-surface">
          <div class="overflow-x-auto">
            <table class="w-full border-collapse" [attr.aria-busy]="loading() ? 'true' : null">
              <caption class="sr-only">
                Assets list
              </caption>
              <thead class="border-b border-line">
                <tr class="text-left">
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Thumb
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Alt / Id
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Size
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                  >
                    Uploaded
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (a of rows(); track a.id) {
                  <tr
                    class="border-b border-line last:border-b-0 hover:bg-surface-elevated"
                    [attr.data-testid]="'asset-row-' + a.id"
                  >
                    <td class="px-4 py-3">
                      <div
                        class="w-12 h-12 bg-surface-elevated overflow-hidden flex items-center justify-center"
                      >
                        @if (image(a) && thumbSrc(a); as src) {
                          <img
                            [src]="src"
                            [alt]="altText(a) || 'Asset ' + a.id"
                            class="w-full h-full object-cover"
                          />
                        } @else if (image(a)) {
                          <span
                            class="text-[9px] tracking-widest uppercase text-ink-muted"
                            [attr.aria-label]="'Status: ' + statusLabel(a.status)"
                            [attr.data-testid]="'asset-row-pending-' + a.id"
                          >
                            {{ statusLabel(a.status) }}
                          </span>
                        }
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <a
                        [routerLink]="['/assets', a.id]"
                        class="text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      >
                        {{ altText(a) || a.id }}
                      </a>
                    </td>
                    <td class="px-4 py-3 text-sm text-ink-muted">
                      {{ typeLabel(a.type) }}
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-ink-muted tabular-nums">
                      {{ formatBytes(bytesOf(a)) }}
                    </td>
                    <td class="px-4 py-3">
                      <app-badge
                        [tone]="statusTone(a.status)"
                        [ariaLabel]="'Status: ' + statusLabel(a.status)"
                      >
                        {{ statusLabel(a.status) }}
                      </app-badge>
                    </td>
                    <td class="px-4 py-3 text-xs text-ink-muted">
                      {{ a.createdAt | adminDate }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <app-pagination
        [page]="page()"
        [pageSize]="pageSize()"
        [total]="total()"
        [loading]="loading()"
        testIdPrefix="assets"
        (pageChange)="goToPage($event)"
      />
    </section>
  `,
})
export class AssetsLibraryPage implements OnInit, OnDestroy {
  private readonly service = inject(AssetsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroy$ = new Subject<void>();

  protected readonly placeholderRows = [0, 1, 2, 3, 4, 5, 6, 7];

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly Asset[]>([]);
  readonly total = signal(0);
  readonly view = signal<'grid' | 'list'>('grid');
  readonly mediaQueue = signal<readonly MediaQueueRow[]>([]);

  readonly canUpload = computed(() => this.authStore.permissions().has('assets:create'));
  readonly hasInFlight = computed(() =>
    this.mediaQueue().some((r) => r.status === 'UPLOADING' || r.status === 'PROCESSING'),
  );

  readonly queryParams = toSignal(this.route.queryParams, {
    initialValue: {} as Record<string, string | undefined>,
  });
  readonly page = computed(() => Number(this.queryParams()['page'] ?? '1'));
  readonly pageSize = computed(() => Number(this.queryParams()['pageSize'] ?? '24'));
  readonly typeFilter = computed<AssetType | null>(() => {
    const raw = this.queryParams()['type'];
    return ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].includes(raw ?? '') ? (raw as AssetType) : null;
  });
  readonly statusFilter = computed<AssetStatus | null>(() => {
    const raw = this.queryParams()['status'];
    return ['PENDING', 'PROCESSING', 'READY', 'FAILED'].includes(raw ?? '')
      ? (raw as AssetStatus)
      : null;
  });
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly typeOptions: ReadonlyArray<{ value: AssetType | null; label: string }> = [
    { value: null, label: 'All' },
    { value: 'IMAGE', label: 'Images' },
    { value: 'VIDEO', label: 'Videos' },
    { value: 'DOCUMENT', label: 'Docs' },
    { value: 'AUDIO', label: 'Audio' },
  ];

  readonly statusOptions: ReadonlyArray<{ value: AssetStatus | null; label: string }> = [
    { value: null, label: 'Any' },
    { value: 'READY', label: 'Ready' },
    { value: 'PROCESSING', label: 'Processing' },
    { value: 'PENDING', label: 'Pending' },
    { value: 'FAILED', label: 'Failed' },
  ];

  protected readonly image = isImage;
  protected readonly video = isVideo;
  protected readonly typeLabel = assetTypeLabel;
  protected readonly statusTone = assetStatusTone;
  protected readonly statusLabel = assetStatusLabel;
  protected readonly formatBytes = formatBytes;
  protected readonly bytesOf = bytesOf;
  protected readonly altText = (asset: { alt?: unknown; id: string }): string =>
    assetAltText(asset, this.authStore.locale(), this.storeSettings.defaultLocale());

  private nextTempIdSeq = 0;
  private activeUploadSlots = 0;
  private readonly uploadWaiting: string[] = [];
  private readonly uploadSubs = new Map<string, Subscription>();
  private readonly pollSubs = new Map<string, Subscription>();
  private readonly pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pollDeadlines = new Map<string, number>();
  private readonly autoClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Resolves the canonical `'thumbnail'` variant URL for grid card +
   * list-table thumb. Returns `null` for PROCESSING / PENDING / FAILED
   * assets and for rows whose `variants` payload is missing — the template
   * falls through to a status-label block in those cases instead of
   * rendering a broken `<img>`.
   */
  protected thumbSrc(asset: Asset): string | null {
    return this.service.tryPublicVariantUrl(asset, 'thumbnail')?.url ?? null;
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(() => this.fetch());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.uploadSubs.forEach((s) => s.unsubscribe());
    this.uploadSubs.clear();
    this.pollSubs.forEach((s) => s.unsubscribe());
    this.pollSubs.clear();
    this.pollTimers.forEach((t) => clearTimeout(t));
    this.pollTimers.clear();
    this.autoClearTimers.forEach((t) => clearTimeout(t));
    this.autoClearTimers.clear();
  }

  setView(view: 'grid' | 'list'): void {
    this.view.set(view);
  }

  setType(value: AssetType | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { type: value, page: null },
      queryParamsHandling: 'merge',
    });
  }

  setStatus(value: AssetStatus | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: value, page: null },
      queryParamsHandling: 'merge',
    });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page },
      queryParamsHandling: 'merge',
    });
  }

  // ── Upload queue ───────────────────────────────────────────────────────

  onFilesAdded(files: File[]): void {
    if (!this.canUpload() || files.length === 0) return;
    const added = files.map((file) => this.appendRow(file, 'UPLOADING'));
    for (const row of added) {
      this.requestUploadSlot(row.tempId);
    }
  }

  onFilesRejected(rejections: DropzoneFileRejection[]): void {
    if (!this.canUpload() || rejections.length === 0) return;
    for (const rejection of rejections) {
      this.appendRow(rejection.file, 'FAILED', this.formatRejection(rejection));
    }
  }

  retry(tempId: string): void {
    const row = this.findRow(tempId);
    if (!row || row.status !== 'FAILED') return;
    this.patchRow(tempId, {
      status: 'UPLOADING',
      progress: 0,
      error: undefined,
      assetId: undefined,
    });
    this.requestUploadSlot(tempId);
    this.focusRowDismiss(tempId);
  }

  dismiss(tempId: string): void {
    const sub = this.uploadSubs.get(tempId);
    if (sub) {
      sub.unsubscribe();
      this.uploadSubs.delete(tempId);
      this.releaseUploadSlot();
    }
    const pollSub = this.pollSubs.get(tempId);
    if (pollSub) {
      pollSub.unsubscribe();
      this.pollSubs.delete(tempId);
    }
    const timer = this.pollTimers.get(tempId);
    if (timer) {
      clearTimeout(timer);
      this.pollTimers.delete(tempId);
    }
    this.pollDeadlines.delete(tempId);
    const autoClear = this.autoClearTimers.get(tempId);
    if (autoClear) {
      clearTimeout(autoClear);
      this.autoClearTimers.delete(tempId);
    }
    const waitingIdx = this.uploadWaiting.indexOf(tempId);
    if (waitingIdx >= 0) this.uploadWaiting.splice(waitingIdx, 1);
    const focusTarget = this.pickFocusFallback(tempId);
    this.mediaQueue.update((rows) => rows.filter((r) => r.tempId !== tempId));
    queueMicrotask(() => focusTarget?.focus());
  }

  private focusRowDismiss(tempId: string): void {
    queueMicrotask(() => {
      const btn = this.host.nativeElement.querySelector(
        `[data-testid="assets-upload-dismiss-${tempId}"] button`,
      ) as HTMLElement | null;
      btn?.focus();
    });
  }

  private pickFocusFallback(tempId: string): HTMLElement | null {
    const rows = this.mediaQueue();
    const idx = rows.findIndex((r) => r.tempId === tempId);
    const root = this.host.nativeElement;
    const sibling = rows[idx + 1] ?? rows[idx - 1];
    if (sibling) {
      const next = root.querySelector(
        `[data-testid="assets-upload-dismiss-${sibling.tempId}"] button`,
      ) as HTMLElement | null;
      if (next) return next;
    }
    return root.querySelector(
      '[data-testid="assets-dropzone"] [data-testid="dropzone-trigger"]',
    ) as HTMLElement | null;
  }

  protected queueLabel(status: MediaQueueStatus): string {
    switch (status) {
      case 'UPLOADING':
        return 'Uploading';
      case 'PROCESSING':
        return 'Processing';
      case 'READY':
        return 'Ready';
      case 'STILL_PROCESSING':
        return 'Still processing';
      case 'FAILED':
        return 'Failed';
    }
  }

  protected queueTone(status: MediaQueueStatus): 'success' | 'warning' | 'error' | 'info' {
    switch (status) {
      case 'READY':
        return 'success';
      case 'FAILED':
        return 'error';
      case 'STILL_PROCESSING':
        return 'warning';
      case 'PROCESSING':
      case 'UPLOADING':
        return 'info';
    }
  }

  private appendRow(file: File, status: MediaQueueStatus, error?: string): MediaQueueRow {
    const tempId = `mq-${++this.nextTempIdSeq}`;
    const row: MediaQueueRow = {
      tempId,
      file,
      progress: 0,
      status,
      ...(error ? { error } : {}),
    };
    this.mediaQueue.update((rows) => [...rows, row]);
    return row;
  }

  private patchRow(tempId: string, patch: Partial<MediaQueueRow>): void {
    this.mediaQueue.update((rows) =>
      rows.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)),
    );
  }

  private findRow(tempId: string): MediaQueueRow | null {
    return this.mediaQueue().find((r) => r.tempId === tempId) ?? null;
  }

  private requestUploadSlot(tempId: string): void {
    if (this.activeUploadSlots >= MAX_CONCURRENT_UPLOADS) {
      this.uploadWaiting.push(tempId);
      return;
    }
    this.startUpload(tempId);
  }

  private startUpload(tempId: string): void {
    const row = this.findRow(tempId);
    if (!row) return;
    this.activeUploadSlots += 1;
    let assetId: string | null = null;
    const sub = this.service
      .uploadWithProgress(row.file)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (event) => {
          if (event.kind === 'progress') {
            const ratio = event.progress.ratio ?? 0;
            this.patchRow(tempId, {
              progress: Math.max(0, Math.min(100, Math.round(ratio * 100))),
            });
            return;
          }
          assetId = event.asset.id;
          this.patchRow(tempId, {
            status: 'PROCESSING',
            progress: 100,
            assetId: event.asset.id,
          });
          if (event.asset.status === 'READY') {
            this.markReady(tempId);
          }
        },
        error: (err: unknown) => {
          this.uploadSubs.delete(tempId);
          this.patchRow(tempId, { status: 'FAILED', error: this.formatUploadError(err) });
          this.releaseUploadSlot();
          this.maybeRefetchOnDrain();
        },
        complete: () => {
          this.uploadSubs.delete(tempId);
          this.releaseUploadSlot();
          if (assetId) {
            const current = this.findRow(tempId);
            if (current && current.status === 'PROCESSING') {
              this.startPolling(tempId, assetId);
            }
          }
        },
      });
    this.uploadSubs.set(tempId, sub);
  }

  private releaseUploadSlot(): void {
    this.activeUploadSlots = Math.max(0, this.activeUploadSlots - 1);
    while (this.activeUploadSlots < MAX_CONCURRENT_UPLOADS && this.uploadWaiting.length > 0) {
      const next = this.uploadWaiting.shift();
      if (!next) break;
      const row = this.findRow(next);
      if (!row || row.status !== 'UPLOADING') continue;
      this.startUpload(next);
    }
  }

  private startPolling(tempId: string, assetId: string): void {
    this.pollDeadlines.set(tempId, Date.now() + POLL_CAP_MS);
    this.schedulePoll(tempId, assetId);
  }

  private schedulePoll(tempId: string, assetId: string): void {
    const timer = setTimeout(() => {
      this.pollTimers.delete(tempId);
      this.runPoll(tempId, assetId);
    }, POLL_INTERVAL_MS);
    this.pollTimers.set(tempId, timer);
  }

  private runPoll(tempId: string, assetId: string): void {
    const row = this.findRow(tempId);
    if (!row || row.status !== 'PROCESSING') return;
    const deadline = this.pollDeadlines.get(tempId) ?? 0;
    if (Date.now() >= deadline) {
      this.patchRow(tempId, { status: 'STILL_PROCESSING' });
      this.pollDeadlines.delete(tempId);
      this.maybeRefetchOnDrain();
      return;
    }
    const sub = this.service
      .get(assetId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (asset) => {
          this.pollSubs.delete(tempId);
          if (asset.status === 'READY') {
            this.markReady(tempId);
            return;
          }
          if (asset.status === 'FAILED') {
            this.patchRow(tempId, { status: 'FAILED', error: 'Processing failed.' });
            this.pollDeadlines.delete(tempId);
            this.maybeRefetchOnDrain();
            return;
          }
          this.schedulePoll(tempId, assetId);
        },
        error: (err: unknown) => {
          this.pollSubs.delete(tempId);
          this.patchRow(tempId, { status: 'FAILED', error: this.formatUploadError(err) });
          this.pollDeadlines.delete(tempId);
          this.maybeRefetchOnDrain();
        },
      });
    this.pollSubs.set(tempId, sub);
  }

  private markReady(tempId: string): void {
    this.patchRow(tempId, { status: 'READY', progress: 100 });
    this.pollDeadlines.delete(tempId);
    this.maybeRefetchOnDrain();
    const timer = setTimeout(() => {
      this.autoClearTimers.delete(tempId);
      this.mediaQueue.update((rows) => rows.filter((r) => r.tempId !== tempId));
    }, READY_AUTO_CLEAR_MS);
    this.autoClearTimers.set(tempId, timer);
  }

  private maybeRefetchOnDrain(): void {
    if (this.hasInFlight()) return;
    this.fetch();
  }

  private formatRejection(rejection: DropzoneFileRejection): string {
    if (rejection.reason === 'size') return 'File exceeds the 10 MB upload limit.';
    return 'File type is not allowed.';
  }

  private formatUploadError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to upload assets.';
    if (err instanceof ApiError && err.message) return err.message;
    if (err instanceof Error && err.message) return err.message;
    return 'Upload failed.';
  }

  private fetch(): void {
    const query: ListAssetsQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
    };
    if (this.typeFilter()) query.type = this.typeFilter() as AssetType;
    if (this.statusFilter()) query.status = this.statusFilter() as AssetStatus;

    this.loading.set(true);
    this.error.set(null);
    this.service
      .list(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.meta.total);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view assets.';
    if (err instanceof ApiNotFoundError) return 'Assets not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load assets.';
  }
}
