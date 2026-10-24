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
import { Dialog } from '@angular/cdk/dialog';
import { Subject, takeUntil } from 'rxjs';
import { BadgeComponent, ButtonComponent, SkeletonComponent, openConfirmDialog } from '@admin-ui';
import { StorefrontConfigService, type StorefrontSection } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { AuthStore } from '../../core/stores/auth.store';
import { sectionTypeLabel } from './storefront.utils';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/storefront/:pageSlug` — manage the ordered stack of sections on a page.
 *
 * Supports:
 *  - Drill up/down to reorder (persists via `PATCH /pages/:slug/sections/reorder`).
 *  - Toggle visibility (persists via `PATCH /sections/:id/visibility`).
 *  - Delete (with confirm dialog).
 *  - New-section CTA linking to the editor.
 *
 * Drag-and-drop is intentionally skipped for the MVP — up/down buttons are
 * keyboard-friendly and match the brand's brutalist, chrome-free aesthetic.
 */
@Component({
  selector: 'app-storefront-sections-list-page',
  standalone: true,
  imports: [RouterLink, ButtonComponent, BadgeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="storefront-sections-list-page">
      <header class="flex flex-col gap-3">
        <a
          routerLink="/storefront"
          class="text-xs tracking-widest uppercase text-ink-muted hover:text-ink"
          data-testid="storefront-sections-back"
        >
          ← All pages
        </a>
        <div class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">Page</p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight">
              <code class="font-mono text-ink">{{ pageSlug() }}</code>
            </h1>
            <p class="mt-3 tabular text-sm text-ink-muted">
              {{ sections().length }}
              {{ sections().length === 1 ? 'section' : 'sections' }}. Order top-to-bottom matches
              the storefront render order.
            </p>
          </div>
          @if (canManage()) {
            <app-button
              [routerLink]="['/storefront', pageSlug(), 'sections', 'new']"
              data-testid="storefront-section-new"
            >
              New section
            </app-button>
          }
        </div>
      </header>

      <div role="status" aria-live="polite" data-testid="storefront-sections-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      <div role="status" aria-live="polite" data-testid="storefront-sections-notice">
        @if (notice()) {
          <p class="border border-status-success text-ink p-3 tabular text-xs">
            {{ notice() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="16rem" width="100%" />
        </div>
      } @else if (sections().length === 0) {
        <p class="tabular text-sm text-ink-muted" data-testid="storefront-sections-empty">
          This page has no sections yet. Use "New section" to add the first one.
        </p>
      } @else {
        <ul class="flex flex-col gap-3" role="list" data-testid="storefront-sections-list">
          @for (s of sections(); track s.id; let i = $index) {
            <li
              class="border border-line p-4 flex items-center justify-between gap-4 flex-wrap"
              [attr.data-testid]="'storefront-section-row-' + s.id"
            >
              <div class="flex-1 min-w-0 flex flex-col gap-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-xs tracking-widest uppercase text-ink-muted">
                    #{{ s.sortOrder }}
                  </span>
                  <span class="font-mono text-sm text-ink">{{ sectionTypeLabel(s.type) }}</span>
                  <app-badge
                    [tone]="s.isVisible ? 'success' : 'neutral'"
                    [ariaLabel]="s.isVisible ? 'Visible' : 'Hidden'"
                  >
                    {{ s.isVisible ? 'Visible' : 'Hidden' }}
                  </app-badge>
                </div>
                @if (titleText(s); as t) {
                  <p class="tabular text-sm text-ink truncate">{{ t }}</p>
                }
              </div>

              @if (canManage()) {
                <div class="flex items-center gap-2 flex-wrap">
                  <app-button
                    variant="ghost"
                    size="sm"
                    [disabled]="i === 0 || busy()"
                    (clicked)="move(i, -1)"
                    [attr.data-testid]="'storefront-section-up-' + s.id"
                    [ariaLabel]="'Move ' + sectionTypeLabel(s.type) + ' up'"
                  >
                    ↑
                  </app-button>
                  <app-button
                    variant="ghost"
                    size="sm"
                    [disabled]="i === sections().length - 1 || busy()"
                    (clicked)="move(i, 1)"
                    [attr.data-testid]="'storefront-section-down-' + s.id"
                    [ariaLabel]="'Move ' + sectionTypeLabel(s.type) + ' down'"
                  >
                    ↓
                  </app-button>
                  <app-button
                    variant="secondary"
                    size="sm"
                    [disabled]="busy()"
                    (clicked)="toggleVisibility(s)"
                    [attr.data-testid]="'storefront-section-toggle-' + s.id"
                  >
                    {{ s.isVisible ? 'Hide' : 'Show' }}
                  </app-button>
                  <app-button
                    variant="secondary"
                    size="sm"
                    [routerLink]="['/storefront', 'sections', s.id, 'edit']"
                    [attr.data-testid]="'storefront-section-edit-' + s.id"
                  >
                    Edit
                  </app-button>
                  <app-button
                    variant="destructive"
                    size="sm"
                    [disabled]="busy()"
                    (clicked)="confirmDelete(s)"
                    [attr.data-testid]="'storefront-section-delete-' + s.id"
                  >
                    Delete
                  </app-button>
                </div>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class StorefrontSectionsListPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(StorefrontConfigService);
  private readonly dialog = inject(Dialog);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  readonly pageSlug = signal<string>('');
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly sections = signal<StorefrontSection[]>([]);

  readonly canManage = computed(() => this.authStore.hasPermission('storefront_config:manage'));

  protected readonly sectionTypeLabel = sectionTypeLabel;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      // Route uses `{ path: ':pageSlug/**' }` so the leading segment is in
      // `pageSlug` and any slash-extension lands in the wildcard. Concatenate
      // them back into a single slug before we hit the API.
      const base = params.get('pageSlug') ?? '';
      const rest = params.get('rest');
      const slug = rest ? `${base}/${rest}` : base;
      this.pageSlug.set(slug);
      if (slug) this.refresh(slug);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  titleText(s: StorefrontSection): string | null {
    if (!s.title) return null;
    return (
      pickTranslation(
        s.title as Translatable | string | null | undefined,
        this.authStore.locale(),
        '',
        this.storeSettings.defaultLocale(),
      ) || null
    );
  }

  refresh(slug: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.listSections(slug, { pageSize: 100 }).subscribe({
      next: (res) => {
        // Render in sortOrder ascending so the index matches rendering order.
        const sorted = [...res.data].sort((a, b) => a.sortOrder - b.sortOrder);
        this.sections.set(sorted);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  move(index: number, delta: number): void {
    const current = this.sections();
    const target = index + delta;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    this.persistOrder(next);
  }

  private persistOrder(next: StorefrontSection[]): void {
    this.busy.set(true);
    this.notice.set(null);
    this.error.set(null);
    this.service.reorderSections(this.pageSlug(), { orderedIds: next.map((s) => s.id) }).subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set('Order updated.');
        this.refresh(this.pageSlug());
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  toggleVisibility(s: StorefrontSection): void {
    this.busy.set(true);
    this.notice.set(null);
    this.error.set(null);
    this.service.toggleVisibility(s.id, { isVisible: !s.isVisible }).subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set(s.isVisible ? 'Section hidden.' : 'Section visible.');
        this.refresh(this.pageSlug());
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  async confirmDelete(s: StorefrontSection): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: `Delete this ${sectionTypeLabel(s.type)} section?`,
      body: 'This cannot be undone. The section will stop rendering on the storefront immediately.',
      confirmLabel: 'Delete section',
      tone: 'destructive',
    });
    if (!ok) return;
    this.busy.set(true);
    this.notice.set(null);
    this.error.set(null);
    this.service.deleteSection(s.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set('Section deleted.');
        this.refresh(this.pageSlug());
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(this.formatError(err));
      },
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage sections.';
    if (err instanceof ApiNotFoundError) return 'Section no longer exists.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load sections. Please retry.';
  }
}
