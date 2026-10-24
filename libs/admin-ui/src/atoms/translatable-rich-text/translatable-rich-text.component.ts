import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import {
  TabStripComponent,
  type TabStripItem,
} from '../../organisms/tab-strip/tab-strip.component';
import { RichTextEditorComponent } from '../rich-text-editor/rich-text-editor.component';
import {
  TRANSLATABLE_LOCALES,
  type LocaleDirection,
  type TranslatableLocaleTab,
} from '../translatable-locales.token';
import type { TranslatableValue } from '../translatable-input/translatable-input.component';

/**
 * Multi-locale rich text field. Each locale tab owns its own sanitised
 * HTML string; flipping tabs swaps the visible editor content without
 * losing state. Emits the full `{default, fr, en, ...}` object — the
 * default-locale edit mirrors into `default` so storefront resolution
 * still finds a fallback. The tab list comes from `TRANSLATABLE_LOCALES`,
 * which the host app feeds from the store's `supportedLocales`.
 *
 * Visual + keyboard behaviour identical to `TranslatableInputComponent`
 * (same TabStrip under the hood); consumers pick based on whether they
 * want plain text or the constrained rich-text allow-list.
 */
@Component({
  selector: 'app-translatable-rich-text',
  standalone: true,
  imports: [FormsModule, TabStripComponent, RichTextEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TranslatableRichTextComponent),
      multi: true,
    },
  ],
  template: `
    <div class="flex flex-col gap-3" [attr.data-testid]="testId()">
      <app-tab-strip
        [tabs]="tabItems()"
        [active]="activeLocale()"
        [idPrefix]="idPrefix()"
        [ariaLabel]="'Locales for ' + (label() ?? 'this field')"
        [testId]="testId() + '-tabs'"
        (tabChanged)="selectLocale($event)"
      />

      <div
        role="tabpanel"
        [id]="panelId(activeLocale())"
        [attr.aria-labelledby]="idPrefix() + '-' + activeLocale()"
        [attr.lang]="activeLocale()"
        [attr.dir]="activeDir()"
      >
        <app-rich-text-editor
          [testId]="testId() + '-editor'"
          [ariaLabel]="fieldAriaLabel()"
          [inputId]="inputId()"
          [invalid]="invalid()"
          [ngModel]="currentValue()"
          (ngModelChange)="onLocaleChange($event)"
          [disabled]="isDisabled()"
        ></app-rich-text-editor>
      </div>
    </div>
  `,
})
export class TranslatableRichTextComponent implements ControlValueAccessor {
  readonly label = input<string | null>(null);
  readonly invalid = input<boolean>(false);
  readonly testId = input<string>('translatable-rich-text');
  readonly idPrefix = input<string>('translatable-rt');
  readonly inputId = input<string | null>(null);
  /**
   * Locale codes to expose as tabs, overriding the store's list for this one
   * field. The FIRST entry is treated as the default. Leave unbound to follow
   * the store.
   */
  readonly locales = input<readonly string[] | undefined>(undefined);

  private readonly storeLocales = inject(TRANSLATABLE_LOCALES);

  private readonly _value = signal<TranslatableValue>({ default: '' });
  private readonly _activeOverride = signal<string | null>(null);
  protected readonly isDisabled = signal<boolean>(false);

  /** The tabs actually rendered: the `locales` override, else the store. */
  readonly effectiveTabs = computed<readonly TranslatableLocaleTab[]>(() => {
    const tabs = this.storeLocales();
    const override = this.locales();
    if (!override || override.length === 0) return tabs;
    return override.map((code) => tabs.find((tab) => tab.code === code) ?? { code, dir: 'ltr' });
  });

  /** The tab list actually rendered, as codes. */
  readonly effectiveLocales = computed<readonly string[]>(() =>
    this.effectiveTabs().map((tab) => tab.code),
  );

  /** The selected tab, clamped to the list that is actually rendered. */
  readonly activeLocale = computed<string>(() => {
    const locales = this.effectiveLocales();
    const chosen = this._activeOverride();
    if (chosen && locales.includes(chosen)) return chosen;
    return locales[0] ?? '';
  });

  /** Writing direction of the tab on screen, so an RTL locale types RTL. */
  readonly activeDir = computed<LocaleDirection>(
    () => this.effectiveTabs().find((tab) => tab.code === this.activeLocale())?.dir ?? 'ltr',
  );

  readonly currentValue = computed(() => this._value()[this.activeLocale()] ?? '');
  readonly fieldAriaLabel = computed(() => {
    const base = this.label() ?? 'Translatable rich text';
    return `${base} (${this.activeLocale().toUpperCase()})`;
  });

  readonly tabItems = computed<TabStripItem[]>(() =>
    this.effectiveLocales().map((code) => ({
      value: code,
      label: code.toUpperCase(),
      badge: this.isFilled(this._value(), code) ? undefined : '·',
    })),
  );

  private onChange: (v: TranslatableValue) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  panelId(locale: string): string {
    return `${this.idPrefix()}-panel-${locale}`;
  }

  selectLocale(locale: string): void {
    this._activeOverride.set(locale);
    this.onTouched();
  }

  onLocaleChange(next: string): void {
    const locale = this.activeLocale();
    const defaultLocale = this.effectiveLocales()[0];
    const value = this._value();
    const updated: TranslatableValue = { ...value, [locale]: next };
    if (locale === defaultLocale) {
      updated.default = next;
    } else if (!updated.default) {
      // See the matching note in `translatable-input.component.ts`: a header-less
      // request reads `default` directly, an empty one renders empty, so a
      // non-default tab seeds it while it is empty and the default-locale tab
      // overwrites it afterwards.
      updated.default = next;
    }
    this._value.set(updated);
    this.onChange(updated);
  }

  writeValue(value: TranslatableValue | null | undefined): void {
    if (value && typeof value === 'object') {
      this._value.set({ ...value, default: value.default ?? '' });
    } else {
      this._value.set({ default: '' });
    }
  }
  registerOnChange(fn: (value: TranslatableValue) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }

  private isFilled(value: TranslatableValue, locale: string): boolean {
    const v = value[locale];
    return typeof v === 'string' && v.replace(/<[^>]+>/g, '').trim().length > 0;
  }
}
