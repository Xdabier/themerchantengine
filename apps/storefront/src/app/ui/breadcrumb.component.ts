import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface InternalNode {
  label: string;
  href?: string;
  isEllipsis?: boolean;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="ariaLabel()">
      <ol class="trail" role="list">
        @for (item of trail(); track $index; let last = $last) {
          <li class="item">
            @if (item.isEllipsis) {
              <button
                type="button"
                class="ellipsis"
                [attr.aria-label]="expandLabel()"
                (click)="expand()"
              >
                …
              </button>
            } @else if (last || !item.href) {
              <span [attr.aria-current]="last ? 'page' : null">{{ item.label }}</span>
            } @else {
              <a [href]="item.href">{{ item.label }}</a>
            }
            @if (!last) {
              <span class="sep" aria-hidden="true">›</span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .trail {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.375rem;
        list-style: none;
        padding: 0;
        margin: 0;
        font-size: var(--brand-text-micro);
        color: var(--brand-text-muted);
      }
      .item {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
      a {
        color: var(--brand-primary);
        text-decoration: none;
      }
      a:hover,
      a:focus-visible {
        text-decoration: underline;
      }
      [aria-current='page'] {
        color: var(--brand-text);
        font-weight: 500;
      }
      .sep {
        color: var(--brand-text-muted);
      }
      .ellipsis {
        background: transparent;
        border: none;
        font: inherit;
        color: var(--brand-primary);
        cursor: pointer;
        padding-block: 0.25rem;
        padding-inline: 0.5rem;
        min-block-size: 44px;
        min-inline-size: 44px;
      }
      .ellipsis:hover,
      .ellipsis:focus-visible {
        text-decoration: underline;
      }
    `,
  ],
})
export class BreadcrumbComponent {
  readonly items = input.required<BreadcrumbItem[]>();
  readonly ariaLabel = input<string>('Breadcrumb');
  readonly maxVisible = input<number>(0); // 0 = no truncation
  readonly expandLabel = input<string>('Show all breadcrumb levels');

  private readonly _expanded = signal(false);

  protected readonly trail = computed<InternalNode[]>(() => {
    const items = this.items();
    const max = this.maxVisible();
    if (this._expanded() || max <= 0 || items.length <= max) return items;
    const head = items[0];
    const tail = items.slice(items.length - 2);
    return [head, { label: '…', isEllipsis: true }, ...tail];
  });

  protected expand(): void {
    this._expanded.set(true);
  }
}
