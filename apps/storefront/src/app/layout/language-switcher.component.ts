import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { getLocaleDefinition } from '@common/locale/locale-registry';

import type { Locale } from '../../i18n/types';
import { buildLocaleSwitchHref } from '../../lib/locale';
import { LocaleService } from '../locale.service';
import { StoreConfigService } from '../services/store-config.service';

import { GlobeIconComponent } from './icons/globe-icon.component';

interface LanguageOption {
  code: string;
  nativeName: string;
  href: string;
  current: boolean;
}

/**
 * Lists every locale the store serves by its own name, so a visitor on a page
 * in a language they cannot read still finds theirs. The names and the set come
 * from the locale registry and the runtime store config.
 */
@Component({
  selector: 'app-language-switcher',
  imports: [GlobeIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closeAndRefocus()',
    '(document:click)': 'closeOnOutsideClick($event)',
  },
  styles: [
    `
      :host {
        position: relative;
        display: inline-block;
      }
      .trigger {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        min-inline-size: 44px;
        min-block-size: 44px;
        padding-inline: 0.75rem;
        border: 0;
        border-radius: var(--brand-radius-md);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .trigger:hover {
        background: var(--switcher-hover-bg, var(--brand-surface-strong));
      }
      .trigger:focus-visible {
        outline: 2px solid var(--switcher-focus, var(--brand-focus));
        outline-offset: 2px;
      }
      .option:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
      }
      .menu {
        position: absolute;
        inset-inline-end: 0;
        inset-block-start: 100%;
        z-index: 40;
        min-inline-size: 10rem;
        margin: 0;
        padding: 0.25rem;
        list-style: none;
        background: var(--brand-surface);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
      }
      .menu.above {
        inset-block-start: auto;
        inset-block-end: 100%;
      }
      .menu.start {
        inset-inline-end: auto;
        inset-inline-start: 0;
      }
      .option {
        display: flex;
        align-items: center;
        min-block-size: 44px;
        padding-inline: 0.75rem;
        border-radius: var(--brand-radius-md);
        color: var(--brand-text);
        text-decoration: none;
      }
      .option:hover {
        background: var(--brand-surface-strong);
      }
      .option[aria-current='true'] {
        font-weight: 600;
      }
    `,
  ],
  template: `
    <button
      type="button"
      class="trigger"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="menuId"
      [attr.data-testid]="idPrefix() + '-language-toggle'"
      (click)="toggle()"
    >
      <app-globe-icon [size]="18" />
      <span>{{ currentName() }}</span>
    </button>
    @if (open()) {
      <ul
        class="menu"
        [class.above]="placement() === 'above'"
        [class.start]="align() === 'start'"
        [id]="menuId"
      >
        @for (option of options(); track option.code) {
          <li>
            <a
              class="option"
              rel="alternate"
              [href]="option.href"
              [attr.hreflang]="option.code"
              [attr.lang]="option.code"
              [attr.aria-current]="option.current ? 'true' : null"
              [attr.data-testid]="idPrefix() + '-language-option-' + option.code"
              >{{ option.nativeName }}</a
            >
          </li>
        }
      </ul>
    }
  `,
})
export class LanguageSwitcherComponent {
  private static nextId = 0;

  private readonly localeService = inject(LocaleService);
  private readonly storeConfig = inject(StoreConfigService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly idPrefix = input.required<string>();
  readonly placement = input<'below' | 'above'>('below');
  /** Which edge of the trigger the menu lines up with. */
  readonly align = input<'start' | 'end'>('end');

  protected readonly menuId = `language-menu-${LanguageSwitcherComponent.nextId++}`;
  protected readonly open = signal(false);

  protected readonly options = computed<LanguageOption[]>(() => {
    const current = this.localeService.locale();
    const url = this.localeService.currentUrl();
    return (this.storeConfig.localization().supportedLocales ?? []).map((code) => ({
      code,
      nativeName: getLocaleDefinition(code)?.nativeName ?? code,
      href: buildLocaleSwitchHref(url, code as Locale),
      current: code === current,
    }));
  });

  protected readonly currentName = computed(() => {
    const code = this.localeService.locale();
    return getLocaleDefinition(code)?.nativeName ?? code;
  });

  protected toggle(): void {
    this.open.update((value) => !value);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected closeAndRefocus(): void {
    if (!this.open()) return;
    this.close();
    this.host.nativeElement.querySelector<HTMLElement>('.trigger')?.focus();
  }

  protected closeOnOutsideClick(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}
