import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { axe, toHaveNoViolations } from 'jest-axe';
import { TRANSLATABLE_LOCALES, buildLocaleTabs } from '../translatable-locales.token';
import type { TranslatableValue } from '../translatable-input/translatable-input.component';
import { TranslatableRichTextComponent } from './translatable-rich-text.component';

/**
 * Tabs as the token now carries them: a code plus the direction the store
 * writes that locale in. Built through the production helper so a spec cannot
 * assert an ordering rule production no longer follows.
 */
function tabs(codes: readonly string[], rtlLocales: readonly string[] = []) {
  return buildLocaleTabs(codes, codes[0] ?? '', rtlLocales);
}

expect.extend(toHaveNoViolations);

/** Unbound `locales`, which is how every real call site uses the atom. */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslatableRichTextComponent],
  template: `
    <app-translatable-rich-text [formControl]="control" label="Description" idPrefix="desc" />
  `,
})
class Host {
  readonly control = new FormControl<TranslatableValue>(
    { default: '<p>Bonjour</p>', fr: '<p>Bonjour</p>', en: '<p>Hello</p>' },
    { nonNullable: true },
  );
}

describe('TranslatableRichTextComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  async function setup(locales: readonly string[] = ['fr', 'en']) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: TRANSLATABLE_LOCALES, useValue: signal(tabs(locales)).asReadonly() }],
    });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await setup();
  });

  function editable(): HTMLElement {
    return fixture.nativeElement.querySelector(
      '[data-testid=translatable-rich-text-editor-editable]',
    ) as HTMLElement;
  }

  function component(): TranslatableRichTextComponent {
    return fixture.debugElement.children[0].componentInstance as TranslatableRichTextComponent;
  }

  it('takes its tab list from the injected store locales when `locales` is unbound', () => {
    expect(component().effectiveLocales()).toEqual(['fr', 'en']);
  });

  it('opens on the first effective locale, not on a hardcoded `en`', () => {
    expect(editable().innerHTML).toBe('<p>Bonjour</p>');
  });

  it('follows a store whose default locale is not the old hardcoded one', async () => {
    await setup(['de', 'en']);
    expect(component().activeLocale()).toBe('de');
  });

  it('switches the active locale state when the tab changes', () => {
    const enTab = fixture.nativeElement.querySelector(
      '[data-testid=translatable-rich-text-tabs-en]',
    ) as HTMLButtonElement;
    enTab.click();
    fixture.detectChanges();
    expect(component().activeLocale()).toBe('en');
    expect(component().currentValue()).toBe('<p>Hello</p>');
  });

  it('updates the correct locale key on edit', () => {
    editable().innerHTML = '<p>Salut</p>';
    editable().dispatchEvent(new Event('input', { bubbles: true }));
    expect(host.control.value.fr).toBe('<p>Salut</p>');
    // Default locale mirrors into `default`.
    expect(host.control.value.default).toBe('<p>Salut</p>');
    // EN stays put.
    expect(host.control.value.en).toBe('<p>Hello</p>');
  });

  it('seeds `default` from the first tab filled, even a non-default one', async () => {
    // Mirrors the matching test on `translatable-input`: the two atoms duplicate
    // the whole locale block, so a behaviour covered on one and not the other is
    // exactly the divergence D3.10 says is a bug by construction.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TRANSLATABLE_LOCALES, useValue: signal(tabs(['fr', 'en'])).asReadonly() },
      ],
    });
    const empty = TestBed.createComponent(EmptyHost);
    empty.detectChanges();
    await Promise.resolve();
    empty.detectChanges();

    const cmp = empty.debugElement.children[0].componentInstance as TranslatableRichTextComponent;
    cmp.selectLocale('en');
    empty.detectChanges();
    cmp.onLocaleChange('<p>Hello</p>');

    expect(empty.componentInstance.control.value.en).toBe('<p>Hello</p>');
    expect(empty.componentInstance.control.value.default).toBe('<p>Hello</p>');
  });

  it('lets the default-locale tab overwrite a `default` seeded by another tab', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TRANSLATABLE_LOCALES, useValue: signal(tabs(['fr', 'en'])).asReadonly() },
      ],
    });
    const empty = TestBed.createComponent(EmptyHost);
    empty.detectChanges();
    await Promise.resolve();
    empty.detectChanges();

    const cmp = empty.debugElement.children[0].componentInstance as TranslatableRichTextComponent;
    cmp.selectLocale('en');
    empty.detectChanges();
    cmp.onLocaleChange('<p>Hello</p>');
    expect(empty.componentInstance.control.value.default).toBe('<p>Hello</p>');

    cmp.selectLocale('fr');
    empty.detectChanges();
    cmp.onLocaleChange('<p>Bonjour</p>');

    expect(empty.componentInstance.control.value.default).toBe('<p>Bonjour</p>');
    expect(empty.componentInstance.control.value.en).toBe('<p>Hello</p>');
  });

  it('has no axe violations', async () => {
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});

/** A brand-new record: every locale empty, which is where `default` seeding matters. */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslatableRichTextComponent],
  template: `
    <app-translatable-rich-text [formControl]="control" label="Description" idPrefix="desc" />
  `,
})
class EmptyHost {
  readonly control = new FormControl<TranslatableValue>({ default: '' }, { nonNullable: true });
}

/** Explicit override, for a field that deliberately differs from the store. */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslatableRichTextComponent],
  template: `
    <app-translatable-rich-text
      [formControl]="control"
      label="Description"
      idPrefix="desc"
      [locales]="['en', 'de']"
    />
  `,
})
class OverrideHost {
  readonly control = new FormControl<TranslatableValue>(
    { default: '<p>Hello</p>', en: '<p>Hello</p>' },
    { nonNullable: true },
  );
}

describe('TranslatableRichTextComponent with an explicit `locales` override', () => {
  it('prefers the bound list over the injected store locales', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TRANSLATABLE_LOCALES, useValue: signal(tabs(['fr', 'en'])).asReadonly() },
      ],
    });
    const fixture = TestBed.createComponent(OverrideHost);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    const component = fixture.debugElement.children[0]
      .componentInstance as TranslatableRichTextComponent;
    expect(component.effectiveLocales()).toEqual(['en', 'de']);
    expect(component.activeLocale()).toBe('en');
  });
});

describe('TranslatableRichTextComponent when the locale list changes underneath it', () => {
  it('falls back to the new first locale when the selected tab disappears', async () => {
    const locales = signal(tabs(['fr', 'en', 'de']));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: TRANSLATABLE_LOCALES, useValue: locales.asReadonly() }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    const component = fixture.debugElement.children[0]
      .componentInstance as TranslatableRichTextComponent;
    component.selectLocale('de');
    fixture.detectChanges();
    expect(component.activeLocale()).toBe('de');

    locales.set(tabs(['fr', 'en']));
    fixture.detectChanges();

    expect(component.activeLocale()).toBe('fr');
  });
});

/**
 * Plan E3.4.2, the rich-text half. Same defect as the plain input: the panel
 * named the language and never the direction, so an Arabic body was composed
 * left to right inside a left-to-right admin.
 */
describe('TranslatableRichTextComponent writing direction', () => {
  async function mount(codes: readonly string[], rtlLocales: readonly string[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TRANSLATABLE_LOCALES, useValue: signal(tabs(codes, rtlLocales)).asReadonly() },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    return fixture;
  }

  function panel(fixture: ComponentFixture<Host>): HTMLElement {
    return fixture.nativeElement.querySelector('[role=tabpanel]') as HTMLElement;
  }

  it('composes left to right on a left-to-right tab', async () => {
    const fixture = await mount(['fr', 'ar'], ['ar']);

    expect(panel(fixture).getAttribute('dir')).toBe('ltr');
  });

  it('composes right to left once the operator switches to the RTL tab', async () => {
    const fixture = await mount(['fr', 'ar'], ['ar']);

    (
      fixture.nativeElement.querySelector(
        '[data-testid=translatable-rich-text-tabs-ar]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(panel(fixture).getAttribute('dir')).toBe('rtl');
    expect(panel(fixture).getAttribute('lang')).toBe('ar');
  });

  it('leaves a locale the store did not mark as left-to-right', async () => {
    const fixture = await mount(['fr', 'ar'], []);

    (
      fixture.nativeElement.querySelector(
        '[data-testid=translatable-rich-text-tabs-ar]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(panel(fixture).getAttribute('dir')).toBe('ltr');
  });
});
