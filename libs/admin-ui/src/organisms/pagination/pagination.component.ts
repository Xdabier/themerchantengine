import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '../../atoms/button/button.component';

/**
 * Shared list pager (admin-qa-remediation plan E, finding E13).
 *
 * Before this, 35 list screens hand-rolled the same footer with two competing
 * label pairs (`Prev`/`Next` vs `Previous page`/`Next page`), and every one of
 * them rendered the nav even on an empty list, so "No campaigns yet." shipped
 * with a pager under it.
 *
 * Contract:
 *  - the "Showing X–Y of Z" meta line is information, so it always renders
 *    (blank when the list is empty);
 *  - the Prev/Next nav only renders when there is more than one page;
 *  - visible labels are `Prev` / `Next`, aria labels are the long form;
 *  - `testIdPrefix` preserves each module's existing testids
 *    (`orders-meta`, `orders-prev`, `orders-next`), and keeps them on the
 *    `app-button` host where the hand-rolled pagers put them, so existing
 *    `[data-testid="orders-prev"] button` selectors still resolve.
 */
@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="flex items-center justify-between gap-4">
      <p
        class="text-xs tabular text-ink-muted"
        [attr.data-testid]="metaTestId()"
        aria-live="polite"
        aria-atomic="true"
      >
        @if (total() > 0) {
          Showing {{ firstRow() }}–{{ lastRow() }} of {{ total() }}
        } @else {
          &nbsp;
        }
      </p>
      @if (totalPages() > 1) {
        <nav class="flex items-center gap-2" aria-label="Pagination">
          <app-button
            variant="secondary"
            size="sm"
            [disabled]="page() <= 1 || loading()"
            (clicked)="pageChange.emit(page() - 1)"
            [attr.data-testid]="prevTestId()"
            ariaLabel="Previous page"
          >
            Prev
          </app-button>
          <app-button
            variant="secondary"
            size="sm"
            [disabled]="page() >= totalPages() || loading()"
            (clicked)="pageChange.emit(page() + 1)"
            [attr.data-testid]="nextTestId()"
            ariaLabel="Next page"
          >
            Next
          </app-button>
        </nav>
      }
    </footer>
  `,
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly loading = input<boolean>(false);
  readonly testIdPrefix = input.required<string>();

  readonly pageChange = output<number>();

  readonly totalPages = computed(() => {
    const size = this.pageSize();
    if (!size || size < 1) return 1;
    return Math.max(1, Math.ceil(this.total() / size));
  });

  protected readonly firstRow = computed(() => (this.page() - 1) * this.pageSize() + 1);
  protected readonly lastRow = computed(() =>
    Math.min(this.page() * this.pageSize(), this.total()),
  );

  protected readonly metaTestId = computed(() => `${this.testIdPrefix()}-meta`);
  protected readonly prevTestId = computed(() => `${this.testIdPrefix()}-prev`);
  protected readonly nextTestId = computed(() => `${this.testIdPrefix()}-next`);
}
