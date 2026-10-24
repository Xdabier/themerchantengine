import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface TabStripItem<T extends string = string> {
  value: T;
  label: string;
  /** Optional badge text shown to the right of the label. */
  badge?: string;
}

/**
 * Brutalist horizontal tab strip. Follows the WAI-ARIA Authoring Practices
 * `tablist`/`tab` pattern — the owning component is responsible for rendering
 * the corresponding `tabpanel` elements with matching ids.
 *
 * Keyboard — left/right arrows move selection between tabs, Home/End jump
 * to ends. Enter/Space activate the focused tab. Tab key moves focus OUT
 * of the strip (roving tabindex).
 *
 * Visual language — underline on the active tab (border-bottom), no fill,
 * no rounding, monotype uppercase labels.
 */
@Component({
  selector: 'app-tab-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="tablist"
      [attr.aria-label]="ariaLabel()"
      class="flex items-end gap-6 border-b border-line overflow-x-auto"
      [attr.data-testid]="testId()"
    >
      @for (tab of tabs(); track tab.value; let idx = $index) {
        <button
          type="button"
          role="tab"
          [id]="tabId(tab.value)"
          [attr.aria-selected]="active() === tab.value"
          [attr.aria-controls]="panelId(tab.value)"
          [attr.tabindex]="active() === tab.value ? 0 : -1"
          class="text-xs tracking-widest uppercase px-1 pb-3 border-b-2 motion-safe:transition-colors motion-safe:duration-75 -mb-px focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          [class.border-ink]="active() === tab.value"
          [class.text-ink]="active() === tab.value"
          [class.border-transparent]="active() !== tab.value"
          [class.text-ink-muted]="active() !== tab.value"
          [class.hover:text-ink]="active() !== tab.value"
          [attr.data-testid]="testId() + '-' + tab.value"
          (click)="select(tab.value)"
          (keydown)="onKeydown($event, idx)"
        >
          {{ tab.label }}
          @if (tab.badge) {
            <span class="ml-2 text-xs tracking-widest uppercase border border-line px-1.5 py-0.5">
              {{ tab.badge }}
            </span>
          }
        </button>
      }
    </div>
  `,
})
export class TabStripComponent<T extends string = string> {
  readonly tabs = input.required<readonly TabStripItem<T>[]>();
  readonly active = input.required<T>();
  /** Stable prefix for the `id` + `aria-controls` attributes. */
  readonly idPrefix = input<string>('tab');
  readonly ariaLabel = input<string | null>(null);
  readonly testId = input<string>('tab-strip');

  readonly tabChanged = output<T>();

  tabId(value: T): string {
    return `${this.idPrefix()}-${value}`;
  }

  panelId(value: T): string {
    return `${this.idPrefix()}-panel-${value}`;
  }

  select(value: T): void {
    if (value === this.active()) return;
    this.tabChanged.emit(value);
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const items = this.tabs();
    if (items.length === 0) return;
    let next = index;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % items.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[next];
    this.tabChanged.emit(target.value);
    queueMicrotask(() => {
      const el = document.getElementById(this.tabId(target.value));
      el?.focus();
    });
  }
}
