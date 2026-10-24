import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  type OnInit,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { OverlayModule, type ConnectedPosition } from '@angular/cdk/overlay';
import { FORM_FIELD_CONTEXT } from '@admin-ui';
import type { EntityOption, EntitySelectSource } from './entity-select.types';

let nextInstanceId = 0;

const DEBOUNCE_MS = 200;

/**
 * Server-driven searchable picker for any paginated admin list.
 *
 * Built for the manual-order flow, where a single `pageSize=100` fetch put 745
 * of 845 products permanently out of reach with nothing on screen saying so.
 * The result count is therefore always rendered, open or closed: a truncated
 * list is allowed, a silent one is not.
 *
 * It takes an `EntitySelectSource`, never a service, so it stays usable from
 * any feature module. Concrete sources are built from `libs/admin-services` by
 * feature code. Plan F (F8, zone lookups) reuses the same contract rather than
 * building a second lookup — see the plan's D2.
 *
 * It lives here rather than in `libs/admin-ui` for the dependency-direction
 * reason the `translatable` pipe does: admin-ui primitives stay free of
 * feature and service coupling. Promote it with an injection token following
 * `libs/admin-ui/src/organisms/asset-picker/asset-picker.token.ts` if a lib
 * consumer ever needs it.
 *
 * ARIA 1.2 combobox: the input keeps focus and owns `aria-activedescendant`,
 * the popup is a plain listbox. Drops into a Reactive Form as a normal
 * control holding the selected entity id.
 */
/** Loose comparison for the create-affordance dedupe. UI hint only. */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

@Component({
  selector: 'app-entity-select',
  standalone: true,
  imports: [OverlayModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => EntitySelectComponent),
      multi: true,
    },
  ],
  template: `
    <div class="flex flex-col gap-2 relative" cdkOverlayOrigin #origin="cdkOverlayOrigin">
      <input
        [id]="id()"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listboxId"
        [attr.aria-activedescendant]="activeDescendant()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-label]="ariaLabel()"
        [attr.placeholder]="placeholder()"
        [attr.data-testid]="testId()"
        [disabled]="isDisabled()"
        [value]="query()"
        class="min-h-[44px] w-full px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (focus)="openList()"
        (blur)="onBlur()"
      />

      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="origin"
        [cdkConnectedOverlayOpen]="open()"
        [cdkConnectedOverlayWidth]="overlayWidth()"
        [cdkConnectedOverlayPositions]="overlayPositions"
        (overlayOutsideClick)="close()"
      >
        <div
          class="border border-line bg-surface max-h-72 overflow-y-auto"
          (mousedown)="$event.preventDefault()"
        >
          <ul
            role="listbox"
            [id]="listboxId"
            [attr.aria-label]="listboxLabel()"
            [attr.aria-busy]="loading() ? 'true' : null"
          >
            @for (o of options(); track o.id; let i = $index) {
              <li
                role="option"
                data-entity-option
                [id]="optionDomId(i)"
                [attr.aria-selected]="o.id === selectedId()"
                [class]="optionClass(i)"
                (click)="commit(o)"
                (mousemove)="activeIndex.set(i)"
              >
                <span class="block text-sm text-ink">{{ o.label }}</span>
                @if (o.sublabel) {
                  <span class="block text-xs tabular text-ink-muted">{{ o.sublabel }}</span>
                }
              </li>
            }
            @if (canLoadMore()) {
              <li
                role="option"
                [id]="optionDomId(options().length)"
                aria-selected="false"
                [class]="optionClass(options().length)"
                [attr.data-testid]="testId() ? testId() + '-load-more' : null"
                (click)="loadMore()"
                (mousemove)="activeIndex.set(options().length)"
              >
                <span class="block text-sm tracking-widest uppercase text-ink">
                  Load more results
                </span>
              </li>
            }
            @if (canCreate()) {
              <li
                role="option"
                [id]="optionDomId(createIndex())"
                aria-selected="false"
                [class]="optionClass(createIndex())"
                [attr.data-testid]="testId() ? testId() + '-create' : null"
                (click)="emitCreate()"
                (mousemove)="activeIndex.set(createIndex())"
              >
                <span class="block text-sm text-ink">
                  {{ createOptionLabel() }} "{{ query().trim() }}"
                </span>
              </li>
            }
            @if (!loading() && options().length === 0 && !failed() && !canCreate()) {
              <li class="px-3 py-3 text-sm text-ink-muted">No matches.</li>
            }
            @if (loading()) {
              <li class="px-3 py-3 text-sm text-ink-muted">Searching…</li>
            }
          </ul>
        </div>
      </ng-template>

      <p
        [id]="statusId"
        role="status"
        aria-live="polite"
        class="text-xs tabular text-ink-muted"
        [attr.data-testid]="testId() ? testId() + '-status' : null"
      >
        {{ statusText() }}
      </p>
    </div>
  `,
})
export class EntitySelectComponent<T = unknown> implements ControlValueAccessor, OnInit {
  private readonly parentField = inject(FORM_FIELD_CONTEXT, { optional: true });
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly source = input.required<EntitySelectSource<T>>();
  readonly id = input<string | null>(null);
  readonly testId = input<string | null>(null);
  readonly placeholder = input<string>('Type to search…');
  readonly ariaLabel = input<string | null>(null);
  readonly listboxLabel = input<string>('Results');
  /**
   * Offer a final option that accepts the typed term as a NEW value rather
   * than picking an existing one. Opt-in, so every current caller keeps a
   * pure pick-one-of-these control.
   */
  readonly allowCreate = input<boolean>(false);
  readonly createOptionLabel = input<string>('Add');

  readonly selectionChange = output<EntityOption<T> | null>();
  /** The typed term, when the operator chose to use it as a new value. */
  readonly createRequested = output<string>();

  private readonly instance = nextInstanceId++;
  /**
   * Below the input, flipping above when there is no room. The overlay escapes
   * any `overflow` ancestor, which an absolutely positioned popup cannot: the
   * specifications matrix wraps its table in `overflow-x-auto`, and that clipped
   * the option list in half.
   */
  protected readonly overlayPositions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
  ];

  protected readonly listboxId = `entity-select-${this.instance}-listbox`;
  protected readonly statusId = `entity-select-${this.instance}-status`;

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly options = signal<readonly EntityOption<T>[]>([]);
  protected readonly total = signal(0);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly activeIndex = signal(-1);
  protected readonly isDisabled = signal(false);
  /** Match the input, so the popup never looks detached from its control. */
  protected readonly overlayWidth = signal<number | string>('auto');

  private readonly term = signal('');
  private page = 1;
  private initialised = false;
  private pendingResolveId: string | null = null;
  private readonly typed$ = new Subject<string>();

  protected readonly canLoadMore = computed(
    () => !this.loading() && this.options().length < this.total(),
  );

  /**
   * Whether the typed term is worth offering as a new value.
   *
   * The comparison is a plain trim/lowercase/collapse rather than any
   * domain-specific fold: this component is generic, and the check is only a
   * UI hint. The server owns the real identity rule, so a false positive here
   * costs nothing, the typed term resolves to the same record on save.
   */
  protected readonly canCreate = computed(() => {
    if (!this.allowCreate()) return false;
    const term = normalise(this.query());
    if (term === '') return false;
    return !this.options().some((o) => normalise(o.label) === term);
  });

  /**
   * Roving-index model. Real options occupy 0..n-1; each footer that is
   * currently offered takes the next index in this order. Kept as explicit
   * computeds because the previous single-expression form could only ever
   * express one footer, so adding a second silently made the last one
   * unreachable by keyboard.
   */
  protected readonly loadMoreIndex = computed(() =>
    this.canLoadMore() ? this.options().length : -1,
  );

  protected readonly createIndex = computed(() =>
    this.canCreate() ? this.options().length + (this.canLoadMore() ? 1 : 0) : -1,
  );

  protected readonly lastIndex = computed(() => {
    if (this.createIndex() >= 0) return this.createIndex();
    if (this.loadMoreIndex() >= 0) return this.loadMoreIndex();
    return this.options().length - 1;
  });

  protected readonly activeDescendant = computed(() => {
    const i = this.activeIndex();
    return this.open() && i >= 0 ? this.optionDomId(i) : null;
  });

  protected readonly describedBy = computed(() => {
    const parent = this.parentField?.describedBy() ?? null;
    return [this.statusId, parent].filter(Boolean).join(' ') || null;
  });

  protected readonly statusText = computed(() => {
    if (this.failed()) return 'Could not load results. Try again.';
    if (this.loading()) return 'Searching…';
    const total = this.total();
    const create = this.canCreate()
      ? ` Press Enter on "${this.createOptionLabel()} ${this.query().trim()}" to use it.`
      : '';
    if (total === 0) return `No matches.${create}`;
    return `Showing ${this.options().length} of ${total}.${create}`;
  });

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    this.typed$
      .pipe(debounceTime(DEBOUNCE_MS), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((term) => {
        this.term.set(term);
        this.page = 1;
        this.fetch(false);
      });
  }

  ngOnInit(): void {
    this.initialised = true;
    // Prime page 1 so the count is on screen before the operator touches
    // anything. The whole point of the picker is that truncation is visible.
    this.fetch(false);
    const pending = this.pendingResolveId;
    if (pending) {
      this.pendingResolveId = null;
      this.resolveLabel(pending);
    }
  }

  protected optionDomId(index: number): string {
    return `entity-select-${this.instance}-option-${index}`;
  }

  protected optionClass(index: number): string {
    const base = 'px-3 py-2 cursor-pointer border-b border-surface-elevated last:border-b-0';
    return index === this.activeIndex() ? `${base} bg-surface-elevated` : base;
  }

  protected openList(): void {
    if (this.isDisabled()) return;
    const host = this.hostEl.nativeElement.querySelector('div');
    if (host) this.overlayWidth.set(host.getBoundingClientRect().width);
    this.open.set(true);
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.open.set(true);
    this.activeIndex.set(-1);
    // The text no longer describes the committed entity, so the control must
    // not keep claiming it does.
    if (this.selectedId() !== null) {
      this.selectedId.set(null);
      this.onChange('');
      this.selectionChange.emit(null);
    }
    // The rows on screen and the count above them describe the previous
    // query until the debounced search returns. Saying so from the keystroke,
    // rather than only once the request is in flight, is the difference
    // between an operator reading a settled list and an operator reading a
    // stale one under a confident "Showing N of M". `distinctUntilChanged`
    // means retyping the committed term fires nothing, so this must not claim
    // to be searching in that case or the status would never clear.
    if (value !== this.term()) this.loading.set(true);
    this.typed$.next(value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const lastIndex = this.lastIndex();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.open.set(true);
        this.activeIndex.set(Math.min(this.activeIndex() + 1, lastIndex));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
        break;
      case 'Home':
        if (!this.open()) return;
        event.preventDefault();
        this.activeIndex.set(0);
        break;
      case 'End':
        if (!this.open()) return;
        event.preventDefault();
        this.activeIndex.set(lastIndex);
        break;
      case 'Enter': {
        if (!this.open()) return;
        event.preventDefault();
        const i = this.activeIndex();
        if (i < 0) return;
        // Dispatch by index rather than by "is there an option here":
        // the old form treated every index past the real options as the
        // load-more footer, so a second footer could never be activated.
        if (i === this.createIndex()) {
          this.emitCreate();
        } else if (i === this.loadMoreIndex()) {
          this.loadMore();
        } else {
          const picked = this.options()[i];
          if (picked) this.commit(picked);
        }
        break;
      }
      case 'Escape':
        if (!this.open()) return;
        event.preventDefault();
        this.close();
        break;
      default:
        break;
    }
  }

  protected commit(option: EntityOption<T>): void {
    this.selectedId.set(option.id);
    this.query.set(option.label);
    this.onChange(option.id);
    this.selectionChange.emit(option);
    this.close();
  }

  /**
   * Hand the typed term back and close. Deliberately does NOT set
   * `selectedId` or call `onChange`: there is no record to select yet, and
   * the parent decides what the term becomes.
   */
  protected emitCreate(): void {
    const term = this.query().trim();
    if (term === '') return;
    this.createRequested.emit(term);
    this.close();
  }

  protected loadMore(): void {
    if (!this.canLoadMore()) return;
    this.page += 1;
    this.fetch(true);
  }

  protected onBlur(): void {
    // Without this a caller that allows creation loses the typed term the
    // moment the operator tabs to the next cell: `onInput` publishes nothing
    // outward, so the text would exist only in this component's own state.
    if (this.canCreate()) this.createRequested.emit(this.query().trim());
    this.close();
    this.onTouched();
  }

  protected close(): void {
    this.open.set(false);
    this.activeIndex.set(-1);
  }

  private fetch(append: boolean): void {
    this.loading.set(true);
    this.failed.set(false);
    this.source()
      .search(this.term(), this.page)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.options.set(append ? [...this.options(), ...res.options] : res.options);
          this.total.set(res.total);
          this.loading.set(false);
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading.set(false);
          this.failed.set(true);
          if (!append) this.options.set([]);
          this.cdr.markForCheck();
        },
      });
  }

  writeValue(value: string | null | undefined): void {
    const id = value ?? '';
    if (!id) {
      this.selectedId.set(null);
      this.query.set('');
      return;
    }
    if (this.selectedId() === id) return;
    this.selectedId.set(id);
    const known = this.options().find((o) => o.id === id);
    if (known) {
      this.query.set(known.label);
      return;
    }
    // Forms write the initial value before inputs are bound, so a resolve
    // that early has no source to call yet.
    if (!this.initialised) {
      this.pendingResolveId = id;
      return;
    }
    this.resolveLabel(id);
  }

  private resolveLabel(id: string): void {
    const source = this.source();
    if (!source.resolve) return;
    source
      .resolve([id])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          const match = rows.find((r) => r.id === id);
          if (match) this.query.set(match.label);
          this.cdr.markForCheck();
        },
        error: () => undefined,
      });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }
}
