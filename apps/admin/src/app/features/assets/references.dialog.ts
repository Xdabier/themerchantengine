import { CommonModule } from '@angular/common';
import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnDestroy,
  Optional,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  AssetsService,
  type AssetReferenceKind,
  type AssetReferenceRow,
  type AssetReferences,
} from '@admin-services';
import { ApiError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { ButtonComponent } from '@admin-ui';
import { pluralUnit, pluralize } from '../../shared/format/pluralize';

/**
 * S18 / DR-07 — Asset references dialog. Lists every entity (product,
 * variant, review, return, category, section) currently using a given
 * asset, with click-through to the owning entity's edit route. Operators
 * use this dialog to clear references before hard-deleting an asset.
 *
 * Built on `@angular/cdk/dialog` — CDK supplies focus trap, backdrop, and
 * Esc-to-close. Brand layer (constitution §3.9) layers the mode's surface,
 * its ink, zero border-radius. a11y (§3.10): titled dialog,
 * `role="list"`, status announcer, ≥ 44 × 44 px tab targets.
 */

export interface AssetReferencesDialogData {
  readonly assetId: string;
  readonly assetLabel?: string;
  readonly titleId?: string;
}

interface ReferenceFilterChip {
  readonly value: AssetReferenceKind | null;
  readonly label: string;
}

const FILTER_CHIPS: ReadonlyArray<ReferenceFilterChip> = [
  { value: null, label: 'All' },
  { value: 'product', label: 'Products' },
  { value: 'variant', label: 'Variants' },
  { value: 'review', label: 'Reviews' },
  { value: 'return', label: 'Returns' },
  { value: 'category', label: 'Categories' },
  { value: 'section', label: 'Sections' },
];

const KIND_LABEL: Record<AssetReferenceKind, string> = {
  product: 'Product',
  variant: 'Variant',
  review: 'Review',
  return: 'Return',
  category: 'Category',
  section: 'Section',
};

let dialogInstanceCounter = 0;

@Component({
  selector: 'app-asset-references-dialog',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full max-w-2xl bg-surface border border-line flex flex-col max-h-[85vh]"
      data-testid="asset-references-dialog"
    >
      <header class="px-6 py-5 border-b border-line flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
            Where this asset is used
          </h2>
          @if (data.assetLabel) {
            <p class="mt-1 font-mono text-xs text-ink-muted truncate">{{ data.assetLabel }}</p>
          }
        </div>
        <app-button
          variant="ghost"
          size="sm"
          ariaLabel="Close references dialog"
          testId="asset-references-close"
          (clicked)="close()"
        >
          Close
        </app-button>
      </header>

      <div class="px-6 py-4 border-b border-line">
        <div class="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter references">
          @for (chip of chips; track chip.value) {
            <button
              type="button"
              class="text-xs tracking-widest uppercase px-3 py-2 min-h-11 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              [class.border-ink]="filter() === chip.value"
              [class.text-ink]="filter() === chip.value"
              [class.border-line]="filter() !== chip.value"
              [class.text-ink-muted]="filter() !== chip.value"
              [attr.aria-pressed]="filter() === chip.value"
              [attr.data-testid]="'asset-references-chip-' + (chip.value ?? 'all')"
              (click)="setFilter(chip.value)"
            >
              {{ chip.label }}
              @if (countFor(chip.value); as count) {
                <span class="ms-2 font-mono tabular-nums">{{ count }}</span>
              }
            </button>
          }
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-4" [attr.aria-busy]="loading()">
        <p class="sr-only" role="status" aria-live="polite" data-testid="asset-references-status">
          {{ statusLine() }}
        </p>
        @if (loading()) {
          <p
            class="text-sm text-ink-muted text-center py-12"
            data-testid="asset-references-loading"
            aria-hidden="true"
          >
            Loading references…
          </p>
        } @else if (error()) {
          <p
            class="border border-status-error text-ink p-3 text-xs"
            role="alert"
            aria-live="assertive"
            data-testid="asset-references-error"
          >
            {{ error() }}
          </p>
        } @else if (rows().length === 0) {
          <p
            class="text-sm text-ink-muted text-center py-12"
            data-testid="asset-references-empty"
            aria-hidden="true"
          >
            No references match the current filter.
          </p>
        } @else {
          <ul class="flex flex-col" role="list" data-testid="asset-references-list">
            @for (row of rows(); track row.id + '|' + row.kind) {
              <li class="border-b border-line last:border-b-0">
                <button
                  type="button"
                  class="w-full text-start py-3 px-2 min-h-11 flex items-center justify-between gap-4 text-ink hover:bg-surface-elevated focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  [attr.data-testid]="'asset-references-row-' + row.kind + '-' + row.id"
                  (click)="navigate(row)"
                >
                  <div class="min-w-0">
                    <p class="text-xs tracking-widest uppercase text-ink-muted">
                      {{ kindLabel(row.kind) }}
                    </p>
                    <p class="mt-1 font-mono text-sm truncate">{{ row.label }}</p>
                  </div>
                  <span aria-hidden="true" class="text-ink-muted font-mono">→</span>
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <footer class="px-6 py-4 border-t border-line flex items-center justify-between gap-3">
        <p class="text-xs text-ink-muted" data-testid="asset-references-total">
          @if (references(); as r) {
            <span class="font-mono tabular-nums">{{ r.total }}</span>
            total {{ pluralUnit(r.total, 'reference') }}
          }
        </p>
        <app-button variant="ghost" size="sm" (clicked)="close()" testId="asset-references-done">
          Done
        </app-button>
      </footer>
    </div>
  `,
})
export class AssetReferencesDialogComponent implements OnDestroy {
  protected readonly pluralUnit = pluralUnit;
  protected readonly chips = FILTER_CHIPS;
  protected readonly kindLabel = (k: AssetReferenceKind): string => KIND_LABEL[k];

  readonly titleId: string;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly references = signal<AssetReferences | null>(null);
  readonly filter = signal<AssetReferenceKind | null>(null);

  readonly rows = computed<AssetReferenceRow[]>(() => {
    const refs = this.references();
    if (!refs) return [];
    const f = this.filter();
    if (f === null) {
      return [
        ...refs.products,
        ...refs.variants,
        ...refs.reviews,
        ...refs.returns,
        ...refs.categories,
        ...refs.sections,
      ];
    }
    return this.bucket(refs, f);
  });

  readonly statusLine = computed(() => {
    if (this.loading()) return 'Loading references.';
    if (this.error()) return this.error() ?? '';
    const total = this.rows().length;
    if (total === 0) return 'No references for this filter.';
    return `${pluralize(total, 'reference')} shown.`;
  });

  private readonly destroy$ = new Subject<void>();
  private readonly assets = inject(AssetsService);
  private readonly router = inject(Router);

  constructor(
    private readonly ref: DialogRef<void>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: AssetReferencesDialogData,
  ) {
    this.titleId = data?.titleId ?? `asset-refs-${++dialogInstanceCounter}-title`;
    this.fetch(data?.assetId);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  protected setFilter(value: AssetReferenceKind | null): void {
    this.filter.set(value);
  }

  protected countFor(kind: AssetReferenceKind | null): number | null {
    const refs = this.references();
    if (!refs) return null;
    if (kind === null) return refs.total;
    const length = this.bucket(refs, kind).length;
    return length;
  }

  protected close(): void {
    this.ref.close();
  }

  protected navigate(row: AssetReferenceRow): void {
    this.ref.close();
    void this.router.navigateByUrl(row.route);
  }

  private fetch(assetId: string | undefined): void {
    if (!assetId) {
      this.loading.set(false);
      this.error.set('Asset id missing.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.assets
      .getReferences(assetId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (refs) => {
          this.references.set(refs);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private bucket(refs: AssetReferences, kind: AssetReferenceKind): AssetReferenceRow[] {
    switch (kind) {
      case 'product':
        return refs.products;
      case 'variant':
        return refs.variants;
      case 'review':
        return refs.reviews;
      case 'return':
        return refs.returns;
      case 'category':
        return refs.categories;
      case 'section':
        return refs.sections;
    }
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load references.';
  }
}

/**
 * Service-style helper wrapping CDK Dialog for the references dialog.
 * Mirrors `openConfirmDialog` and `openAssetPicker` for pattern parity.
 */
export function openAssetReferencesDialog(
  dialog: Dialog,
  data: AssetReferencesDialogData,
): Promise<void> {
  const titleId = data.titleId ?? `asset-refs-${++dialogInstanceCounter}-title`;
  const ref = dialog.open<void>(AssetReferencesDialogComponent, {
    data: { ...data, titleId },
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    role: 'dialog',
    ariaModal: true,
    ariaLabelledBy: titleId,
    hasBackdrop: true,
    disableClose: false,
  });
  return new Promise<void>((resolve) => {
    const sub = ref.closed.subscribe(() => {
      resolve();
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
