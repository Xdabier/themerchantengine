import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CategoriesService } from '@admin-services';
import { ApiForbiddenError } from '@admin-types';
import { SkeletonComponent } from '@admin-ui';
import { AuthStore } from '../../core/stores/auth.store';
import { flattenAllCategories } from '../../features/categories/categories.utils';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * Multi-select category picker over the admin category tree, shared by the
 * product create wizard and the product edit page so the two cannot drift.
 *
 * It lives here rather than in `libs/admin-ui` because it injects a service,
 * the same rule `country-select.component.ts` states.
 *
 * Degradation matters more here than in most pickers. `GET /v1/admin/categories`
 * needs `categories:view`, which a `products:update` operator may not hold, and
 * the product update replaces the category set rather than merging it. So a
 * picker that rendered an empty list on a 403 would read as "no categories
 * assigned", and one save would detach every one of them. On failure this
 * component therefore renders an explicit read-only notice, keeps whatever the
 * product already had visible as plain text, and never emits `selectionChange`,
 * so the parent never marks itself dirty and never sends `categoryIds`.
 */
@Component({
  selector: 'app-category-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkeletonComponent],
  template: `
    <fieldset
      class="border border-line p-4"
      [attr.data-testid]="testId()"
      [attr.aria-describedby]="hintId"
    >
      <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">
        {{ legend() }}
      </legend>

      @if (loading()) {
        <app-skeleton height="1rem" width="60%" />
      } @else if (failed()) {
        <p
          [id]="hintId"
          class="tabular text-sm text-ink border border-status-error p-3"
          role="alert"
          data-testid="category-picker-degraded"
        >
          {{ failureMessage() }}
        </p>
        @if (selectedIds().length > 0) {
          <p class="mt-3 tabular text-xs text-ink-muted">
            This product currently has {{ selectedIds().length }} categor{{
              selectedIds().length === 1 ? 'y' : 'ies'
            }}. They are left untouched.
          </p>
        }
      } @else if (rows().length === 0) {
        <p [id]="hintId" class="tabular text-sm text-ink-muted" data-testid="category-picker-empty">
          No categories defined yet.
        </p>
      } @else {
        <p [id]="hintId" class="text-xs tabular text-ink-muted mb-3">
          {{ hint() }}
        </p>
        <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto" role="list">
          @for (row of rows(); track row.id) {
            <li>
              <label class="flex items-center gap-3 text-sm tabular min-h-[44px]">
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-ink"
                  [checked]="isSelected(row.id)"
                  [disabled]="disabled()"
                  (change)="toggle(row.id, $event)"
                  [attr.data-testid]="'product-category-' + row.id"
                />
                <span [style.paddingInlineStart.rem]="row.depth * 0.75">{{ row.label }}</span>
              </label>
            </li>
          }
        </ul>
        <p class="mt-3 text-xs tabular text-ink-muted" role="status" aria-live="polite">
          {{ selectedIds().length }} selected
        </p>
      }
    </fieldset>
  `,
})
export class CategoryPickerComponent {
  private readonly categoriesService = inject(CategoriesService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);

  readonly selectedIds = input<readonly string[]>([]);
  readonly disabled = input<boolean>(false);
  readonly legend = input<string>('Categories');
  readonly testId = input<string>('product-categories');
  readonly hint = input<string>(
    'Pick one or more categories. The storefront uses one of them for the breadcrumb and related products; which one is not selectable yet.',
  );

  readonly selectionChange = output<readonly string[]>();

  protected readonly hintId = 'category-picker-hint';
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  protected readonly failureMessage = signal('Could not load categories.');
  private readonly tree = signal<readonly { id: string; label: string; depth: number }[]>([]);

  protected readonly rows = computed(() => this.tree());

  private readonly selectedSet = computed(() => new Set(this.selectedIds()));

  constructor() {
    this.categoriesService
      .tree()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (tree) => {
          this.tree.set(
            flattenAllCategories(tree, this.authStore.locale(), this.storeSettings.defaultLocale()),
          );
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.failed.set(true);
          this.failureMessage.set(
            err instanceof ApiForbiddenError
              ? 'You do not have permission to view categories, so they cannot be changed here. Saving leaves them as they are.'
              : 'Could not load categories, so they cannot be changed here. Saving leaves them as they are.',
          );
        },
      });
  }

  protected isSelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  protected toggle(id: string, event: Event): void {
    // Never emit from the degraded state: the parent turns any emission into a
    // dirty flag, and a save from a picker that could not read the tree would
    // replace the product's real categories with whatever this list holds.
    if (this.failed() || this.disabled()) return;
    const checked = (event.target as HTMLInputElement).checked;
    const next = new Set(this.selectedIds());
    if (checked) next.add(id);
    else next.delete(id);
    this.selectionChange.emit([...next]);
  }
}
