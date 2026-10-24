import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { AccountIconComponent } from './account-icon.component';
import { CartIconComponent } from './cart-icon.component';
import { ChevronIconComponent } from './chevron-icon.component';
import { GlobeIconComponent } from './globe-icon.component';
import { HomeIconComponent } from './home-icon.component';
import { SearchIconComponent } from './search-icon.component';

import { LocaleService } from '../../locale.service';
import type { Locale } from '../../../i18n/types';

class FakeLocaleService {
  readonly locale = signal<Locale>('en');
  readonly strings = signal({} as never);
  private readonly _direction = signal<'ltr' | 'rtl'>('ltr');
  readonly direction = this._direction.asReadonly();

  setDirection(dir: 'ltr' | 'rtl') {
    this._direction.set(dir);
  }
}

@Component({
  standalone: true,
  imports: [
    HomeIconComponent,
    SearchIconComponent,
    CartIconComponent,
    AccountIconComponent,
    GlobeIconComponent,
    ChevronIconComponent,
  ],
  template: `
    <app-home-icon [size]="size()" />
    <app-search-icon />
    <app-cart-icon />
    <app-account-icon />
    <app-globe-icon />
    <app-chevron-icon [orientation]="orientation()" />
  `,
})
class HostComponent {
  readonly size = signal(24);
  readonly orientation = signal<'start' | 'end'>('end');
}

function setup() {
  const fakeLocale = new FakeLocaleService();
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [{ provide: LocaleService, useValue: fakeLocale }],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return { fixture, fakeLocale };
}

describe('layout icons', () => {
  it.each([
    'app-home-icon',
    'app-search-icon',
    'app-cart-icon',
    'app-account-icon',
    'app-globe-icon',
    'app-chevron-icon',
  ] as const)('%s renders an inline svg', (selector) => {
    const { fixture } = setup();
    const host = fixture.nativeElement.querySelector(selector) as HTMLElement;
    expect(host).toBeTruthy();
    const svg = host.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('home icon honours the size input via --icon-size', () => {
    const { fixture } = setup();
    fixture.componentInstance.size.set(32);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('app-home-icon') as HTMLElement;
    expect(host.style.getPropertyValue('--icon-size')).toBe('32px');
  });

  it.each(['start', 'end'] as const)('chevron renders the %s orientation path', (orientation) => {
    const { fixture } = setup();
    fixture.componentInstance.orientation.set(orientation);
    fixture.detectChanges();
    const host = fixture.nativeElement.querySelector('app-chevron-icon') as HTMLElement;
    const path = host.querySelector('path');
    expect(path).toBeTruthy();
    if (orientation === 'end') {
      expect(path?.getAttribute('d')).toContain('m9 6');
    } else {
      expect(path?.getAttribute('d')).toContain('m15 6');
    }
  });

  it('chevron renders with no LocaleService in the injector', () => {
    // The chevron no longer reads a locale direction, so it must resolve
    // without LocaleService bound. A reintroduced dependency fails here
    // with a NullInjectorError rather than silently flipping the glyph.
    TestBed.configureTestingModule({ imports: [ChevronIconComponent] });
    const fixture = TestBed.createComponent(ChevronIconComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('svg')).toBeTruthy();
    expect(host.classList.contains('rtl-flip')).toBe(false);
  });

  it('no icon carries the rtl-flip class: both locales are left-to-right', () => {
    const { fixture } = setup();
    for (const sel of [
      'app-home-icon',
      'app-search-icon',
      'app-cart-icon',
      'app-account-icon',
      'app-globe-icon',
      'app-chevron-icon',
    ]) {
      const host = fixture.nativeElement.querySelector(sel) as HTMLElement;
      expect(host.classList.contains('rtl-flip'), sel).toBe(false);
    }
  });

  it('every icon renders an svg with the shared --icon-size hook', () => {
    const { fixture } = setup();
    for (const sel of [
      'app-home-icon',
      'app-search-icon',
      'app-cart-icon',
      'app-account-icon',
      'app-globe-icon',
      'app-chevron-icon',
    ]) {
      const host = fixture.nativeElement.querySelector(sel) as HTMLElement;
      expect(host.querySelector('svg')).toBeTruthy();
      expect(host.style.getPropertyValue('--icon-size')).not.toBe('');
    }
  });

  describe('direction mirroring', () => {
    // Logical CSS flips the layout; a glyph is artwork and does not follow.
    // A chevron drawn pointing right still points right after the box around
    // it flips, and in an RTL page "forward" is left.
    it('mirrors the chevron under an rtl locale', () => {
      const { fixture, fakeLocale } = setup();
      const host = fixture.nativeElement.querySelector('app-chevron-icon') as HTMLElement;
      expect(host.classList.contains('rtl-flip')).toBe(false);

      fakeLocale.setDirection('rtl');
      fixture.detectChanges();

      expect(host.classList.contains('rtl-flip')).toBe(true);
    });

    it('leaves the symmetric icons alone in either direction', () => {
      // Mirroring a cart or a magnifier would be a defect, not a translation.
      const { fixture, fakeLocale } = setup();
      fakeLocale.setDirection('rtl');
      fixture.detectChanges();

      for (const selector of [
        'app-home-icon',
        'app-search-icon',
        'app-cart-icon',
        'app-account-icon',
        'app-globe-icon',
      ]) {
        const host = fixture.nativeElement.querySelector(selector) as HTMLElement;
        expect(host.classList.contains('rtl-flip'), selector).toBe(false);
      }
    });
  });
});

// silence unused imports
void vi;
