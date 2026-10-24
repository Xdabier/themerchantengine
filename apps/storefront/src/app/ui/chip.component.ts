import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="chip"
      [class.selected]="selected()"
      [class.removable]="removable()"
      [attr.role]="selectable() ? 'button' : null"
      [attr.tabindex]="selectable() ? '0' : null"
      [attr.aria-pressed]="selectable() ? selected() : null"
      (click)="onSelect()"
      (keydown)="onKeydown($event)"
    >
      <span class="label"><ng-content /></span>
      @if (removable()) {
        <button
          type="button"
          class="remove"
          [attr.aria-label]="removeLabel()"
          (click)="onRemove($event)"
        >
          ×
        </button>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding-block: 0.375rem;
        padding-inline: 0.75rem;
        background-color: var(--brand-surface-strong);
        color: var(--brand-text);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-full);
        font-size: var(--brand-text-micro);
        font-weight: 500;
        line-height: 1.4;
        min-block-size: 32px;
        cursor: default;
        user-select: none;
      }
      .chip[role='button'] {
        cursor: pointer;
        min-block-size: 44px;
      }
      .chip.selected {
        background-color: var(--brand-primary-dark);
        color: var(--brand-on-primary);
        border-color: var(--brand-primary);
      }
      .chip.removable {
        padding-inline-end: 0.375rem;
      }
      .label {
        line-height: 1;
      }
      .remove {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 24px;
        block-size: 24px;
        padding: 0;
        font-size: 18px;
        line-height: 1;
        background: transparent;
        color: inherit;
        border: none;
        border-radius: var(--brand-radius-full);
        cursor: pointer;
      }
      /* WCAG 2.5.8 + constitution §3.10 — visible glyph stays compact; the
       * pseudo-element expands the hit region to 44×44 so the chip layout is
       * not bloated for visual users. */
      .remove::after {
        content: '';
        position: absolute;
        inset: -10px;
      }
      .remove:hover,
      .remove:focus-visible {
        background-color: var(--brand-hover-overlay);
      }
    `,
  ],
})
export class ChipComponent {
  readonly selected = input<boolean>(false);
  readonly removable = input<boolean>(false);
  readonly selectable = input<boolean>(false);
  readonly removeLabel = input<string>('Remove');

  readonly toggled = output<boolean>();
  readonly removed = output<void>();

  protected onSelect(): void {
    if (!this.selectable()) return;
    this.toggled.emit(!this.selected());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.selectable()) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggled.emit(!this.selected());
    }
  }

  protected onRemove(event: MouseEvent): void {
    event.stopPropagation();
    this.removed.emit();
  }
}
