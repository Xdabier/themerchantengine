import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export interface Tab {
  id: string;
  label: string;
  disabled?: boolean;
}

let nextId = 0;

/**
 * Marker directive for an `<ng-template>` whose content is rendered into the
 * tabpanel matching the same `id` as a `Tab` entry on the parent
 * {@link TabsComponent}.
 *
 * Usage:
 * ```html
 * <app-tabs [tabs]="tabs">
 *   <ng-template appTabPanel="overview">Overview body…</ng-template>
 *   <ng-template appTabPanel="specs">Specs body…</ng-template>
 * </app-tabs>
 * ```
 */
@Directive({
  selector: 'ng-template[appTabPanel]',
  standalone: true,
})
export class TabPanelDirective {
  readonly appTabPanel = input.required<string>();
  readonly template = inject(TemplateRef);
}

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs">
      <div role="tablist" [attr.aria-label]="ariaLabel()" class="tablist">
        @for (tab of tabs(); track tab.id; let i = $index) {
          <button
            type="button"
            role="tab"
            [id]="tabId(tab.id)"
            [attr.aria-selected]="selected() === tab.id"
            [attr.aria-controls]="panelId(tab.id)"
            [attr.tabindex]="selected() === tab.id ? 0 : -1"
            [disabled]="!!tab.disabled"
            class="tab"
            [class.active]="selected() === tab.id"
            (click)="select(tab.id)"
            (keydown)="onKey($event, i)"
          >
            {{ tab.label }}
          </button>
        }
      </div>
      @for (tab of tabs(); track tab.id) {
        <section
          role="tabpanel"
          [id]="panelId(tab.id)"
          [attr.aria-labelledby]="tabId(tab.id)"
          tabindex="0"
          class="panel"
          [hidden]="selected() !== tab.id"
        >
          @if (selected() === tab.id) {
            @let tpl = templateFor(tab.id);
            @if (tpl) {
              <ng-container [ngTemplateOutlet]="tpl" />
            }
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .tablist {
        display: inline-flex;
        gap: 0.25rem;
        border-block-end: 1px solid var(--brand-border);
      }
      .tab {
        background: transparent;
        border: none;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        font: inherit;
        font-weight: 500;
        color: var(--brand-text-muted);
        cursor: pointer;
        min-block-size: 44px;
        border-block-end: 2px solid transparent;
      }
      .tab.active {
        color: var(--brand-primary);
        border-block-end-color: var(--brand-primary);
      }
      .tab:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tab:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: -2px;
      }
      .panel {
        padding-block: 1rem;
      }
    `,
  ],
})
export class TabsComponent {
  readonly tabs = input.required<Tab[]>();
  readonly selectedId = input<string | null>(null);
  readonly ariaLabel = input<string>('Tabs');

  readonly selectedChange = output<string>();

  protected readonly panels = contentChildren(TabPanelDirective);

  private readonly _selected = signal<string | null>(null);
  protected readonly selected = computed(() => this._selected() ?? this.tabs()[0]?.id ?? null);
  private readonly group = `app-tabs-${++nextId}`;

  constructor() {
    effect(() => {
      const next = this.selectedId();
      if (next != null && next !== this._selected()) this._selected.set(next);
    });
  }

  protected select(id: string): void {
    this._selected.set(id);
    this.selectedChange.emit(id);
  }

  protected tabId(id: string): string {
    return `${this.group}-tab-${id}`;
  }
  protected panelId(id: string): string {
    return `${this.group}-panel-${id}`;
  }

  protected templateFor(id: string): TemplateRef<unknown> | null {
    const match = this.panels().find((p) => p.appTabPanel() === id);
    return match?.template ?? null;
  }

  protected onKey(event: KeyboardEvent, index: number): void {
    const items = this.tabs();
    if (items.length === 0) return;
    let nextIdx = index;
    if (event.key === 'ArrowRight') nextIdx = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') nextIdx = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = items.length - 1;
    else return;
    event.preventDefault();
    const next = items[nextIdx];
    if (!next.disabled) this.select(next.id);
  }
}
