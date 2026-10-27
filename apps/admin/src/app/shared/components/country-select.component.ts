import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { CountriesService, type CountryRow } from '@admin-services';
import { FORM_FIELD_CONTEXT } from '@admin-ui';

/**
 * Country picker bound to the Countries module, for every form that stores an
 * ISO 3166 alpha-2 code. Drops into a Reactive Form as
 * `formControlName="country"`: the control still holds the two-letter code, so
 * the existing `^[A-Z]{2}$` validators stay in place as the safety net.
 *
 * It lives here rather than in `libs/admin-ui` because it injects a service,
 * and admin-ui primitives stay service-free.
 *
 * Degradation: `GET /v1/admin/countries` needs `settings:view`, which an
 * order-only operator may not have. When the catalogue cannot be read the
 * component renders the plain ISO-2 text input instead, so the form keeps
 * working for every permission profile.
 */
@Component({
  selector: 'app-country-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CountrySelectComponent),
      multi: true,
    },
  ],
  template: `
    @if (failed()) {
      <input
        [id]="id()"
        maxlength="2"
        [disabled]="isDisabled()"
        [value]="value()"
        [attr.aria-describedby]="describedBy()"
        class="w-24 min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        data-testid="country-fallback-input"
        (input)="onInput($event)"
        (blur)="onBlur()"
      />
      <p [id]="hintId" class="mt-2 text-xs tabular text-ink-muted">
        Two uppercase letters, e.g. QA, FR, US.
      </p>
    } @else {
      <select
        [id]="id()"
        [disabled]="isDisabled() || rows().length === 0"
        [value]="value()"
        [attr.aria-describedby]="describedBy()"
        class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        data-testid="country-select"
        (change)="onSelect($event)"
        (blur)="onBlur()"
      >
        @if (rows().length === 0) {
          <option [value]="value()">Loading countries…</option>
        } @else {
          @if (!value()) {
            <option value="">Select a country</option>
          }
          @if (enabledRows().length > 0) {
            <optgroup label="Shipping destinations">
              @for (c of enabledRows(); track c.code) {
                <option [value]="c.code">{{ c.name }} ({{ c.code }})</option>
              }
            </optgroup>
          }
          @if (otherRows().length > 0) {
            <optgroup label="Other countries">
              @for (c of otherRows(); track c.code) {
                <option [value]="c.code">{{ c.name }} ({{ c.code }})</option>
              }
            </optgroup>
          }
        }
      </select>
    }
  `,
})
export class CountrySelectComponent implements ControlValueAccessor {
  private readonly countries = inject(CountriesService);
  private readonly parentField = inject(FORM_FIELD_CONTEXT, { optional: true });

  readonly id = input<string | null>(null);

  protected readonly hintId = 'country-select-hint';
  protected readonly value = signal<string>('');
  protected readonly isDisabled = signal(false);
  protected readonly failed = signal(false);
  protected readonly rows = signal<readonly CountryRow[]>([]);

  protected readonly enabledRows = computed(() => this.rows().filter((c) => c.enabled));
  protected readonly otherRows = computed(() => this.rows().filter((c) => !c.enabled));

  /** Own hint id in fallback mode, plus whatever the parent FormField wires. */
  protected readonly describedBy = computed(() => {
    const parent = this.parentField?.describedBy() ?? null;
    const own = this.failed() ? this.hintId : null;
    return [own, parent].filter(Boolean).join(' ') || null;
  });

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    this.countries
      .listCached()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (res) => this.rows.set(res.data),
        error: () => this.failed.set(true),
      });
  }

  protected onSelect(event: Event): void {
    this.commit((event.target as HTMLSelectElement).value);
  }

  protected onInput(event: Event): void {
    this.commit((event.target as HTMLInputElement).value.toUpperCase());
  }

  protected onBlur(): void {
    this.onTouched();
  }

  private commit(next: string): void {
    this.value.set(next);
    this.onChange(next);
  }

  writeValue(value: string | null | undefined): void {
    this.value.set(value ?? '');
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
