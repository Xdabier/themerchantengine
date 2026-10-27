import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { ButtonComponent, TRANSLATABLE_LOCALES, localeTabCodes } from '@admin-ui';
import type { ProductSpec, SpecLabelOption } from '@admin-services';
import type { Translatable } from '@admin-types';
import { EntitySelectComponent } from '../../shared/entity-select/entity-select.component';
import type {
  EntityOption,
  EntitySelectSource,
} from '../../shared/entity-select/entity-select.types';

/** One row's edit shape: a value per locale for the label and for the value. */
export interface SpecMatrixRow {
  label: Record<string, string>;
  value: Record<string, string>;
}

/** The payload shape the replace endpoint takes. */
export interface SpecMatrixOutput {
  label: Translatable;
  value: Translatable;
}

/**
 * Loose fold for the in-grid duplicate HINT only.
 *
 * Deliberately NOT the server's `specKey`. That one lives in
 * `libs/shared/common` and `prisma/`, neither of which the admin bundle should
 * pull in, and this check does not need to agree with it byte for byte: the
 * server is the authority and rejects a real collision with a coded 400 that
 * names both spellings. Blocking Save on this would risk refusing a save the
 * server would have accepted, so it marks rows and warns instead.
 */
export function looseFold(text: string): string {
  return (text ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the Translatable a locale-keyed row sends.
 *
 * `default` follows the same rule the Translatable atoms already implement:
 * mirror the default locale, which is the FIRST entry in the tab order, and
 * fall back to the first non-empty locale when that one is blank. The fallback
 * is not cosmetic. The server folds `key` from `label.default` and rejects a
 * label whose default is empty, so a row filled in English only would otherwise
 * be unsavable with no way for the operator to see why.
 */
export function toTranslatable(
  values: Record<string, string>,
  locales: readonly string[],
): Translatable {
  const out: Record<string, string> = {};
  for (const locale of locales) {
    const text = (values[locale] ?? '').trim();
    if (text) out[locale] = text;
  }
  const primary = (values[locales[0]] ?? '').trim();
  const firstFilled = locales.map((l) => (values[l] ?? '').trim()).find((t) => t.length > 0) ?? '';
  return { default: primary || firstFilled, ...out };
}

/**
 * The specifications editor: one row per specification, one column per locale.
 *
 * Locale is the column axis rather than a tab strip per cell. Embedding
 * `TranslatableInputComponent` in every cell would render a full tablist per
 * field, so a 50-row product would emit 100 of them; the locale axis is the
 * same information rendered once. It is also what makes this a matrix rather
 * than a stack of forms, which is what was asked for.
 *
 * A plain `<table>` with `<th scope="col">`, deliberately not `role="grid"`.
 * A grid role strips the native semantics from the cells and obliges an
 * arrow-key cell model, which would fight the label combobox's own ArrowDown
 * listbox traversal. Tab through native inputs is conformant and matches the
 * rest of the admin.
 *
 * Presentational: it owns no HTTP. The edit page and the create wizard both
 * bind it, which is why the label corpus arrives as an `EntitySelectSource`
 * input rather than being fetched here.
 */
@Component({
  selector: 'app-product-specs-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonComponent, EntitySelectComponent],
  template: `
    <div class="flex flex-col gap-4" data-testid="product-specs-matrix">
      @if (rows.length === 0) {
        <p class="tabular text-sm text-ink-muted" data-testid="product-specs-empty">
          No specifications yet. Add one to describe this product.
        </p>
      } @else {
        <div class="overflow-x-auto border border-line">
          <table class="w-full border-collapse">
            <caption class="sr-only">
              Product specifications, one row per specification and one column per locale
            </caption>
            <thead class="border-b border-line">
              <tr class="text-start">
                @for (loc of locales(); track loc) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-3 text-start"
                  >
                    Label · {{ loc }}
                  </th>
                }
                @for (loc of locales(); track loc) {
                  <th
                    scope="col"
                    class="text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-3 text-start"
                  >
                    Value · {{ loc }}
                  </th>
                }
                <th scope="col" class="px-3 py-3"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (group of rows.controls; track group; let i = $index) {
                <tr
                  class="border-b border-line last:border-b-0"
                  [attr.data-testid]="'product-spec-row-' + i"
                >
                  @for (loc of locales(); track loc; let li = $index) {
                    <td class="px-3 py-2 align-top">
                      @if (li === 0) {
                        <app-entity-select
                          [source]="labelSource()"
                          [allowCreate]="true"
                          createOptionLabel="Add"
                          [ariaLabel]="'Specification label, row ' + (i + 1)"
                          [testId]="'product-spec-label-' + i"
                          [placeholder]="'Search or type a label…'"
                          (selectionChange)="onLabelPicked(i, $event)"
                          (createRequested)="onLabelTyped(i, $event)"
                        />
                        @if (duplicateRows().has(i)) {
                          <p
                            class="mt-1 text-xs text-status-error"
                            [attr.data-testid]="'product-spec-duplicate-' + i"
                          >
                            Same specification as another row.
                          </p>
                        }
                      } @else {
                        <input
                          type="text"
                          [formControl]="labelControl(i, loc)"
                          [attr.aria-label]="'Specification label ' + loc + ', row ' + (i + 1)"
                          [attr.data-testid]="'product-spec-label-' + loc + '-' + i"
                          class="min-h-[44px] w-full px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                        />
                      }
                    </td>
                  }
                  @for (loc of locales(); track loc) {
                    <td class="px-3 py-2 align-top">
                      <input
                        type="text"
                        [formControl]="valueControl(i, loc)"
                        [attr.aria-label]="'Specification value ' + loc + ', row ' + (i + 1)"
                        [attr.data-testid]="'product-spec-value-' + loc + '-' + i"
                        class="min-h-[44px] w-full px-3 py-2 bg-surface border border-line text-ink text-sm focus:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                      />
                    </td>
                  }
                  <td class="px-3 py-2 align-top">
                    <div class="flex items-center gap-1 justify-end">
                      <app-button
                        type="button"
                        variant="secondary"
                        size="sm"
                        [disabled]="i === 0 || disabled()"
                        [ariaLabel]="'Move ' + rowName(i) + ' up'"
                        [testId]="'product-spec-up-' + i"
                        (clicked)="move(i, -1)"
                      >
                        ↑
                      </app-button>
                      <app-button
                        type="button"
                        variant="secondary"
                        size="sm"
                        [disabled]="i === rows.length - 1 || disabled()"
                        [ariaLabel]="'Move ' + rowName(i) + ' down'"
                        [testId]="'product-spec-down-' + i"
                        (clicked)="move(i, 1)"
                      >
                        ↓
                      </app-button>
                      <app-button
                        type="button"
                        variant="secondary"
                        size="sm"
                        [disabled]="disabled()"
                        [ariaLabel]="'Remove ' + rowName(i)"
                        [testId]="'product-spec-remove-' + i"
                        (clicked)="removeRow(i)"
                      >
                        Remove
                      </app-button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <div class="flex items-center justify-between gap-4 flex-wrap">
        <app-button
          type="button"
          variant="secondary"
          size="sm"
          [disabled]="disabled() || atCap()"
          (clicked)="addRow()"
          testId="product-spec-add"
        >
          Add specification
        </app-button>
        <p
          class="text-xs tabular text-ink-muted"
          role="status"
          aria-live="polite"
          data-testid="product-specs-status"
        >
          {{ announcement() || rows.length + ' of ' + max() }}
        </p>
      </div>
    </div>
  `,
})
export class ProductSpecsMatrixComponent {
  private readonly fb = inject(FormBuilder);
  private readonly localeTabs = inject(TRANSLATABLE_LOCALES);

  /** Rows to seed the grid with. Re-seeds whenever the identity changes. */
  readonly specs = input<readonly ProductSpec[]>([]);
  readonly disabled = input<boolean>(false);
  readonly max = input<number>(50);
  readonly labelSource = input.required<EntitySelectSource<SpecLabelOption>>();

  /** Fires on every structural or text change, so the parent can track dirty. */
  readonly changed = output<void>();

  readonly rows: FormArray<FormGroup> = this.fb.array<FormGroup>([]);

  protected readonly locales = computed(() => localeTabCodes(this.localeTabs()));
  protected readonly announcement = signal('');
  private readonly revision = signal(0);

  protected readonly atCap = computed(() => {
    this.revision();
    return this.rows.length >= this.max();
  });

  /**
   * Rows whose label folds onto another row's. Both sides are marked, because
   * telling the operator only about the second one hides which pair collided.
   */
  protected readonly duplicateRows = computed(() => {
    this.revision();
    const byKey = new Map<string, number[]>();
    this.rows.controls.forEach((_, i) => {
      const key = looseFold(this.labelControl(i, this.locales()[0]).value ?? '');
      if (!key) return;
      byKey.set(key, [...(byKey.get(key) ?? []), i]);
    });
    const dupes = new Set<number>();
    for (const indexes of byKey.values()) {
      if (indexes.length > 1) indexes.forEach((i) => dupes.add(i));
    }
    return dupes;
  });

  constructor() {
    effect(() => {
      const seed = this.specs();
      const locales = this.locales();
      this.rows.clear({ emitEvent: false });
      for (const spec of seed) {
        this.rows.push(this.makeRow(spec, locales), { emitEvent: false });
      }
      this.revision.update((n) => n + 1);
    });
  }

  protected labelControl(index: number, locale: string): FormControl<string> {
    return this.rows.at(index).get(['label', locale]) as FormControl<string>;
  }

  protected valueControl(index: number, locale: string): FormControl<string> {
    return this.rows.at(index).get(['value', locale]) as FormControl<string>;
  }

  /** Human name for an action label, falling back to the row number. */
  protected rowName(index: number): string {
    const text = String(this.labelControl(index, this.locales()[0]).value ?? '').trim();
    return text || `row ${index + 1}`;
  }

  protected addRow(): void {
    if (this.rows.length >= this.max()) return;
    this.rows.push(this.makeRow(null, this.locales()));
    this.bump();
  }

  protected removeRow(index: number): void {
    const name = this.rowName(index);
    this.rows.removeAt(index);
    this.announcement.set(`${name} removed. It is deleted when you save.`);
    this.bump();
  }

  protected move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= this.rows.length) return;
    const name = this.rowName(index);
    const group = this.rows.at(index);
    this.rows.removeAt(index);
    this.rows.insert(target, group);
    this.announcement.set(`${name} moved to position ${target + 1} of ${this.rows.length}.`);
    this.bump();
  }

  /**
   * An existing label was picked. The option carries the whole Translatable, so
   * every locale column fills at once and only a genuinely new term is ever
   * typed twice.
   */
  protected onLabelPicked(index: number, option: EntityOption<SpecLabelOption> | null): void {
    if (!option) return;
    const label = option.value?.label ?? null;
    for (const locale of this.locales()) {
      const text = label ? ((label as Record<string, string>)[locale] ?? '') : option.label;
      this.labelControl(index, locale).setValue(text);
    }
    this.bump();
  }

  /** A label that does not exist yet: accept the text, write nothing. */
  protected onLabelTyped(index: number, term: string): void {
    this.labelControl(index, this.locales()[0]).setValue(term);
    this.bump();
  }

  /** The payload for the replace endpoint, in row order. */
  toSpecs(): SpecMatrixOutput[] {
    const locales = this.locales();
    return this.rows.controls.map((group) => ({
      label: toTranslatable((group.get('label') as FormGroup).getRawValue(), locales),
      value: toTranslatable((group.get('value') as FormGroup).getRawValue(), locales),
    }));
  }

  /** Rows with a blank label or a blank value cannot be saved. */
  hasIncompleteRow(): boolean {
    return this.toSpecs().some((s) => !s.label.default || !s.value.default);
  }

  private makeRow(spec: ProductSpec | null, locales: readonly string[]): FormGroup {
    const pick = (source: Translatable | null, locale: string): string =>
      source ? ((source as Record<string, string>)[locale] ?? '') : '';
    return this.fb.group({
      label: this.fb.group(
        Object.fromEntries(
          locales.map((l) => [l, this.fb.nonNullable.control(pick(spec?.label ?? null, l))]),
        ),
      ),
      value: this.fb.group(
        Object.fromEntries(
          locales.map((l) => [l, this.fb.nonNullable.control(pick(spec?.value ?? null, l))]),
        ),
      ),
    });
  }

  private bump(): void {
    this.revision.update((n) => n + 1);
    this.changed.emit();
  }
}
