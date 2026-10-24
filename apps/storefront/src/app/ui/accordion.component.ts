import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

let nextId = 0;

export type AccordionMode = 'single' | 'multi';

/**
 * Internal state holder injected from the {@link AccordionComponent} parent
 * down into each {@link AccordionItemComponent}. Exposed via Angular DI rather
 * than a service token so a single accordion instance scopes its own open-set
 * (multiple accordions on the same page do not share state).
 */
@Injectable()
export class AccordionRegistry {
  private readonly _mode = signal<AccordionMode>('single');
  private readonly _openIds = signal<Set<string>>(new Set());

  readonly mode = this._mode.asReadonly();

  setMode(mode: AccordionMode): void {
    this._mode.set(mode);
    if (mode === 'single' && this._openIds().size > 1) {
      const first = this._openIds().values().next().value;
      this._openIds.set(first ? new Set([first]) : new Set());
    }
  }

  isOpen(id: string): boolean {
    return this._openIds().has(id);
  }

  toggle(id: string): boolean {
    const open = this._openIds().has(id);
    const next = new Set(this._openIds());
    if (open) {
      next.delete(id);
    } else {
      if (this._mode() === 'single') next.clear();
      next.add(id);
    }
    this._openIds.set(next);
    return !open;
  }

  setInitial(ids: readonly string[]): void {
    const seed = this._mode() === 'single' && ids.length > 1 ? [ids[0]] : ids;
    this._openIds.set(new Set(seed));
  }
}

@Component({
  selector: 'app-accordion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AccordionRegistry],
  template: `<div class="root"><ng-content /></div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .root {
        border-block-start: 1px solid var(--brand-border);
      }
    `,
  ],
})
export class AccordionComponent {
  readonly mode = input<AccordionMode>('single');
  readonly initialOpen = input<readonly string[]>([]);

  protected readonly registry = inject(AccordionRegistry);

  constructor() {
    effect(() => this.registry.setMode(this.mode()));
    effect(() => this.registry.setInitial(this.initialOpen()));
  }
}

@Component({
  selector: 'app-accordion-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="item">
      <h3 class="header">
        <button
          type="button"
          class="trigger"
          [id]="triggerId()"
          [attr.aria-expanded]="isOpen()"
          [attr.aria-controls]="bodyId()"
          (click)="toggle()"
        >
          <span class="label">{{ heading() }}</span>
          <span class="chevron" [class.rotated]="isOpen()" aria-hidden="true">▾</span>
        </button>
      </h3>
      <div
        class="body"
        role="region"
        [id]="bodyId()"
        [attr.aria-labelledby]="triggerId()"
        [hidden]="!isOpen()"
      >
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        border-block-end: 1px solid var(--brand-border);
      }
      .header {
        margin: 0;
      }
      .trigger {
        display: flex;
        inline-size: 100%;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        background: transparent;
        border: none;
        padding-block: 0.875rem;
        padding-inline: 0.5rem;
        font: inherit;
        font-family: var(--brand-font-display); /* agent_docs/storefront/brand-tokens.md subtitle */
        font-size: var(--brand-text-product);
        font-weight: 500;
        color: var(--brand-text);
        text-align: start;
        cursor: pointer;
        min-block-size: 44px;
      }
      .trigger:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: -2px;
      }
      .chevron {
        transition: transform var(--brand-motion-duration) var(--brand-motion-easing);
      }
      .chevron.rotated {
        transform: rotate(180deg);
      }
      .body {
        padding-block: 0.5rem 1rem;
        padding-inline: 0.5rem;
        color: var(--brand-text-muted);
      }
      @media (prefers-reduced-motion: reduce) {
        .chevron {
          transition: none;
        }
      }
    `,
  ],
})
export class AccordionItemComponent {
  readonly id = input<string>('');
  readonly heading = input.required<string>();
  /**
   * Manual open override for stand-alone usage (no parent {@link AccordionComponent}).
   * When the item is wrapped by an `<app-accordion>`, the registry wins and
   * this input is ignored.
   */
  readonly open = input<boolean>(false);

  readonly toggled = output<boolean>();

  private readonly registry = inject(AccordionRegistry, { optional: true });
  private readonly _id = signal(`app-acc-${++nextId}`);
  private readonly resolvedId = computed(() => this.id() || this._id());

  protected readonly triggerId = computed(() => `${this.resolvedId()}-trigger`);
  protected readonly bodyId = computed(() => `${this.resolvedId()}-body`);

  protected readonly isOpen = computed(() => {
    if (this.registry) return this.registry.isOpen(this.resolvedId());
    return this.open();
  });

  protected toggle(): void {
    if (this.registry) {
      const next = this.registry.toggle(this.resolvedId());
      this.toggled.emit(next);
      return;
    }
    this.toggled.emit(!this.open());
  }
}
