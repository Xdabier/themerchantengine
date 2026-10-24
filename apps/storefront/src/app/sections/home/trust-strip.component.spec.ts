import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideZoneChangeDetection, signal } from '@angular/core';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import { TrustStripComponent, type TrustPillar } from './trust-strip.component';
import { LocaleService } from '../../locale.service';
import { getChromeStrings } from '../../../i18n';
import type { Locale } from '../../../i18n/types';

class FakeLocaleService {
  readonly _locale = signal<Locale>('en');
  readonly locale = this._locale.asReadonly();
  readonly currentUrl = signal('/en/').asReadonly();
  readonly strings = signal(getChromeStrings('en'));
  set(locale: Locale) {
    this._locale.set(locale);
    this.strings.set(getChromeStrings(locale));
  }
}

function setup(pillars: TrustPillar[] | null = null, title: string | null = null) {
  const fakeLocale = new FakeLocaleService();
  TestBed.configureTestingModule({
    imports: [TrustStripComponent],
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter([]),
      { provide: LocaleService, useValue: fakeLocale },
    ],
  });
  const fixture = TestBed.createComponent(TrustStripComponent);
  fixture.componentRef.setInput('pillars', pillars);
  fixture.componentRef.setInput('title', title);
  fixture.detectChanges();
  return { fixture };
}

describe('TrustStripComponent', () => {
  it('renders four pillars from the chrome-strings fallback', () => {
    const { fixture } = setup(null);
    const items = fixture.nativeElement.querySelectorAll('li[data-testid^="home-trust-"]');
    expect(items.length).toBe(4);
  });

  it('declares the border rule on the top edge', () => {
    const { fixture } = setup(null);
    const styleEls = Array.from(
      fixture.nativeElement.getRootNode() instanceof Document
        ? (fixture.nativeElement.getRootNode() as Document).querySelectorAll('style')
        : [],
    ) as HTMLStyleElement[];
    const css = styleEls.map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/\.strip\b[^}]*border-block-start:\s*3px solid var\(--brand-primary\)/);
    // No bottom border, no card surface bg, no border-radius.
    expect(css).not.toContain('border-block-end: 3px solid var(--brand-primary)');
    expect(css).not.toMatch(/\.strip\b[^}]*background-color:/);
    expect(css).not.toMatch(/\.strip\b[^}]*border-radius:/);
  });

  it('renders the title in --brand-primary', () => {
    const { fixture } = setup(null);
    const styleEls = Array.from(
      fixture.nativeElement.getRootNode() instanceof Document
        ? (fixture.nativeElement.getRootNode() as Document).querySelectorAll('style')
        : [],
    ) as HTMLStyleElement[];
    const css = styleEls.map((s) => s.textContent ?? '').join('\n');
    expect(css).toMatch(/\.title\b[^}]*color:\s*var\(--brand-primary\)/);
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const { fixture } = setup(null);
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
        region: { enabled: false },
        'landmark-one-main': { enabled: false },
        'page-has-heading-one': { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});

describe('TrustStripComponent — configured section title (B9)', () => {
  it('renders the operator section title as the strip heading', () => {
    // H3: the heading was hardcoded to the i18n string, so a merchant who
    // titled the section in the admin saw that title nowhere. The fixture
    // title deliberately differs from the i18n heading, otherwise the fallback
    // would satisfy the assertion and the guard could never fail.
    const { fixture } = setup(null, 'Pourquoi Demo Store B9');
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h2');
    expect(heading?.textContent?.trim()).toBe('Pourquoi Demo Store B9');
  });

  it('falls back to the i18n heading when the section carries no title', () => {
    const { fixture } = setup(null, null);
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h2');
    expect(heading?.textContent?.trim()).toBe(getChromeStrings('en').home.trust.heading);
  });

  it('falls back when the title is present but empty', () => {
    const { fixture } = setup(null, '   ');
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h2');
    expect(heading?.textContent?.trim()).toBe(getChromeStrings('en').home.trust.heading);
  });

  it('keeps the heading visually hidden, as it was before B9', () => {
    // Whether the heading becomes visible is a agent_docs/storefront/brand-tokens.md call, not a
    // rendering fix, so the default is unchanged.
    const { fixture } = setup(null, 'Pourquoi Demo Store B9');
    const heading = (fixture.nativeElement as HTMLElement).querySelector('h2');
    expect(heading?.classList.contains('visually-hidden')).toBe(true);
  });
});
