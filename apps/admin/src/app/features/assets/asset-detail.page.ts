import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BadgeComponent, ButtonComponent, SkeletonComponent, openConfirmDialog } from '@admin-ui';
import { AssetsService, type AssetWithUsage } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { openAssetReferencesDialog } from './references.dialog';
import {
  assetAltText,
  assetStatusLabel,
  assetStatusTone,
  assetTypeLabel,
  bytesOf,
  formatBytes,
  formatDimensions,
  isImage,
  isVideo,
} from './assets.utils';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { pluralUnit, pluralize } from '../../shared/format/pluralize';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/assets/:id` — asset metadata + delete action with DR-07 references gate.
 *
 * Delete is behind a confirm dialog only on an unreferenced asset. When
 * the asset is still referenced (any FK reference or — once S19 ships —
 * any `StorefrontSection.config` JSONB reference), the destructive CTA is
 * replaced by a "View references" CTA that opens the references dialog.
 * The backend hard-delete returns 409 ASSET_REFERENCED in the same case
 * (DR-07) — the UI gate is the friendly path, the 409 is the safety net.
 */
@Component({
  selector: 'app-asset-detail-page',
  standalone: true,
  imports: [RouterLink, BadgeComponent, ButtonComponent, SkeletonComponent, AdminDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="asset-detail-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/assets"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Assets
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink font-mono" aria-current="page">
          {{ current()?.id ?? '…' }}
        </span>
      </nav>

      <div role="alert" aria-atomic="true" data-testid="asset-detail-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="40%" />
          <app-skeleton height="16rem" width="100%" />
        </div>
      } @else if (current(); as a) {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">
              {{ typeLabel(a.type) }}
            </p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight truncate">
              {{ altText(a) || a.id }}
            </h1>
            <p class="mt-3 font-mono text-xs text-ink-muted truncate">{{ a.id }}</p>
          </div>
          <app-badge [tone]="statusTone(a.status)" [ariaLabel]="'Status: ' + statusLabel(a.status)">
            {{ statusLabel(a.status) }}
          </app-badge>
        </header>

        <div
          class="border border-line bg-surface-elevated flex items-center justify-center p-6 min-h-[240px]"
        >
          @if (image(a) && previewSrc(a); as src) {
            <img
              [src]="src"
              [alt]="altText(a) || 'Asset ' + a.id"
              class="max-h-[480px] max-w-full object-contain"
              data-testid="asset-preview-image"
            />
          } @else if (image(a)) {
            <p class="text-sm text-ink-muted" data-testid="asset-preview-pending">
              {{ typeLabel(a.type) }} · preview unavailable ({{ statusLabel(a.status) }})
            </p>
          } @else if (video(a)) {
            <!--
              AV3.14 — a.url is the canonical desktop mp4 rendition URL post-AV2
              (image processor flips it on READY for IMAGE rows; video processor
              for VIDEO rows). Binding [src] here is a variant URL, not a raw
              original. When the storefront introduces standalone .html
              templates and the Angular template-parser ESLint rule lands, this
              video/track surface needs to be on the rule's allowlist.
            -->
            <video
              [src]="a.url"
              controls
              class="max-h-[480px] max-w-full"
              [attr.aria-label]="(altText(a) || 'Video preview') + ' — operator preview'"
              data-testid="asset-preview-video"
            >
              <!--
                No srclang: this track is an inert placeholder whose src is the
                media file itself rather than a caption file, so no language
                claim about it can be true. A static "en" was wrong, and binding
                the operator dashboard locale was wrong in a newer way, since two
                operators would then see a different srclang on the same
                never-captioned asset. srclang is only required for
                kind="subtitles".
              -->
              <track kind="captions" [src]="a.url" label="No captions available" />
            </video>
          } @else {
            <p class="text-sm text-ink-muted">{{ typeLabel(a.type) }} · preview not available</p>
          }
        </div>

        <dl
          class="grid grid-cols-1 md:grid-cols-3 gap-6 border border-line p-5"
          aria-label="Asset metadata"
        >
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Type</dt>
            <dd class="mt-1 text-sm text-ink">
              {{ a.mimeType || typeLabel(a.type) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Size</dt>
            <dd class="mt-1 font-mono text-sm text-ink tabular-nums">
              {{ formatBytes(bytesOf(a)) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Dimensions</dt>
            <dd class="mt-1 font-mono text-sm text-ink tabular-nums">
              {{ formatDimensions(a) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Uploaded</dt>
            <dd class="mt-1 text-sm text-ink">
              {{ a.createdAt | adminDate }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">URL</dt>
            <!--
              AV3.14 — operator-facing canonical URL row. a.url points at the
              large webp variant for IMAGE rows and the desktop mp4 rendition
              for VIDEO rows post-AV2 — never at the private original. When
              the storefront introduces standalone .html templates and the
              Angular template-parser ESLint rule lands, this dl row needs to
              be on the rule's allowlist.
            -->
            <dd class="mt-1 font-mono text-xs text-ink truncate" [title]="a.url">
              <a
                [href]="a.url"
                target="_blank"
                rel="noopener"
                class="hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              >
                {{ a.url }}
              </a>
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Usage</dt>
            <dd class="mt-1 text-sm text-ink">
              <span class="font-mono tabular-nums">{{ a.usage.total }}</span>
              {{ pluralUnit(a.usage.total, 'reference') }}
            </dd>
          </div>
        </dl>

        <footer
          class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
        >
          <p id="asset-delete-summary" class="text-xs text-ink-muted">
            @if (a.usage.total > 0) {
              Referenced by {{ pluralize(a.usage.total, 'record') }} — open the references dialog to
              clean up before deleting.
            } @else {
              No references — safe to delete.
            }
          </p>
          <div class="flex items-center gap-3 flex-wrap">
            @if (canViewAssets()) {
              <p id="asset-download-original-help" class="text-xs text-ink-muted">
                @if (a.originalStoragePath) {
                  Opens a signed download link valid for 5 minutes.
                } @else {
                  Original deleted post-cutover — variants only.
                }
              </p>
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="!a.originalStoragePath || downloadingOriginal()"
                [loading]="downloadingOriginal()"
                [ariaDescribedby]="'asset-download-original-help'"
                testId="asset-download-original"
                (clicked)="downloadOriginal()"
              >
                Download original
              </app-button>
            }
            <app-button
              type="button"
              variant="ghost"
              size="sm"
              routerLink="/assets"
              data-testid="asset-back"
            >
              Back to library
            </app-button>
            @if (a.usage.total > 0) {
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [ariaDescribedby]="'asset-delete-summary'"
                testId="asset-view-references"
                (clicked)="viewReferences()"
              >
                View references
              </app-button>
            } @else if (canDelete()) {
              <app-button
                type="button"
                variant="destructive"
                size="sm"
                [disabled]="busy()"
                [loading]="busy()"
                [ariaDescribedby]="'asset-delete-summary'"
                testId="asset-delete"
                (clicked)="confirmDelete()"
              >
                Delete
              </app-button>
            }
          </div>
        </footer>
      }
    </section>
  `,
})
export class AssetDetailPage implements OnInit, OnDestroy {
  protected readonly pluralUnit = pluralUnit;
  protected readonly pluralize = pluralize;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(AssetsService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<AssetWithUsage | null>(null);
  readonly busy = signal(false);
  /** AV3 — tracks the in-flight `getOriginalUrl` request for the button's `[loading]`. */
  readonly downloadingOriginal = signal(false);

  readonly canDelete = computed(() =>
    this.authStore.hasAnyPermission(['assets:delete', 'assets:manage']),
  );
  /** AV3 — `assets:view` (the route guard already requires it) gates the button surface. */
  readonly canViewAssets = computed(() => this.authStore.hasPermission('assets:view'));

  protected readonly image = isImage;
  protected readonly video = isVideo;
  protected readonly typeLabel = assetTypeLabel;
  protected readonly statusTone = assetStatusTone;
  protected readonly statusLabel = assetStatusLabel;
  protected readonly formatBytes = formatBytes;
  protected readonly bytesOf = bytesOf;
  protected readonly formatDimensions = formatDimensions;
  protected readonly altText = (asset: { alt?: unknown; id: string }): string =>
    assetAltText(asset, this.authStore.locale(), this.storeSettings.defaultLocale());

  /**
   * AV3 — preview URL via the canonical resolver shim. Picks `'detail'`
   * intent → `large` webp variant. Returns null on PROCESSING / PENDING /
   * FAILED → template falls back to a status-aware placeholder.
   */
  protected previewSrc(asset: AssetWithUsage): string | null {
    return this.service.tryPublicVariantUrl(asset, 'detail')?.url ?? null;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((p) => {
      const id = p.get('id');
      if (id) this.fetch(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async confirmDelete(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;

    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this asset?',
      body: 'The file will be removed permanently.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;

    this.busy.set(true);
    this.error.set(null);
    this.service.delete(current.id).subscribe({
      next: () => {
        this.busy.set(false);
        void this.router.navigate(['/assets']);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        // DR-07 — backend returns 409 ASSET_REFERENCED if a reference
        // appeared between the page load and this click. Refetch and the
        // template will switch to "View references".
        if (err instanceof ApiError && err.code === 'ASSET_REFERENCED') {
          this.fetch(current.id);
          this.error.set('Asset is referenced — open references to clean up.');
          return;
        }
        this.error.set(this.formatError(err, 'Could not delete asset.'));
      },
    });
  }

  /**
   * AV3 — fetch a 5-minute presigned URL via `GET /v1/admin/assets/:id/original-url`
   * and open it in a new tab. The button is disabled when `originalStoragePath`
   * is NULL (post-cutover deletion), and the click is short-circuited as a
   * defence-in-depth check in case the disabled state is bypassed.
   */
  downloadOriginal(): void {
    const a = this.current();
    // AV3 — legitimate `originalStoragePath` read for the disabled-button
    // gate. The field comes from the admin GET /assets/:id payload via the
    // AV3.11 schema widening; the click flow goes through the dedicated
    // `getOriginalUrl` signed-URL endpoint.
    // eslint-disable-next-line no-restricted-syntax
    if (!a || !a.originalStoragePath || this.downloadingOriginal()) return;
    this.downloadingOriginal.set(true);
    this.error.set(null);
    this.service
      .getOriginalUrl(a.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.downloadingOriginal.set(false);
          window.open(res.url, '_blank', 'noopener');
        },
        error: (err: unknown) => {
          this.downloadingOriginal.set(false);
          this.error.set(this.formatError(err, 'Could not generate download link.'));
        },
      });
  }

  async viewReferences(): Promise<void> {
    const current = this.current();
    if (!current) return;
    await openAssetReferencesDialog(this.dialog, {
      assetId: current.id,
      assetLabel: this.altText(current) || current.id,
    });
    // Refresh usage counts in case the operator cleared references
    // through the click-through links.
    this.fetch(current.id);
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .get(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (a) => {
          this.current.set(a);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown, fallback = 'Could not load asset.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view this asset.';
    if (err instanceof ApiNotFoundError) return 'Asset not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
