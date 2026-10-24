import { ChangeDetectionStrategy, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, UrlSerializer, provideRouter } from '@angular/router';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from '../../locale.service';
import { TrailingSlashUrlSerializer } from '../../trailing-slash-url-serializer';
import { getChromeStrings } from '../../../i18n';
import { type Locale } from '../../../i18n/types';
import ErrorPage from './error.page';
import { fixtureChromeIdentity } from '../../../test-support/store-config-fixtures';

class StubLocaleService {
  private readonly _locale: WritableSignal<Locale>;
  constructor(initial: Locale) {
    this._locale = signal<Locale>(initial);
  }
  readonly locale = () => this._locale();
  readonly chromeIdentity = () => fixtureChromeIdentity('demo', this._locale());
  readonly strings = () => getChromeStrings(this._locale(), this.chromeIdentity());
}

function makeRouteWithFrom(from: string | null): ActivatedRoute {
  const params = new Map<string, string>();
  if (from !== null) params.set('from', from);
  return {
    snapshot: {
      queryParamMap: {
        get: (key: string) => params.get(key) ?? null,
      },
    },
  } as unknown as ActivatedRoute;
}

async function renderError(opts: {
  locale: Locale;
  from: string | null;
}): Promise<ComponentFixture<ErrorPage>> {
  const stub = new StubLocaleService(opts.locale);
  TestBed.overrideComponent(ErrorPage, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: UrlSerializer, useClass: TrailingSlashUrlSerializer },
      { provide: LocaleService, useValue: stub },
      { provide: ActivatedRoute, useValue: makeRouteWithFrom(opts.from) },
    ],
  });
  const fixture = TestBed.createComponent(ErrorPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('ErrorPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.head.innerHTML = '';
  });

  // jsdom default origin is `http://localhost`; same-origin paths like
  // `/en/catalog` resolve against that base without any window stubbing.

  it('renders the localized error heading + body in French', async () => {
    const fixture = await renderError({ locale: 'fr', from: null });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#error-heading')?.textContent?.trim()).toBe(
      'Une erreur est survenue de notre côté',
    );
    expect(root.querySelector('.body')?.textContent?.trim()).toBe(
      'Nous travaillons dessus. Réessayez dans un instant.',
    );
  });

  it('renders the localized error heading + body in English', async () => {
    const fixture = await renderError({ locale: 'en', from: null });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#error-heading')?.textContent?.trim()).toBe(
      'Something went wrong on our end',
    );
  });

  it('shows only the home CTA when no `from` query param is set', async () => {
    const fixture = await renderError({ locale: 'en', from: null });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.cta')).toHaveLength(1);
    const home = root.querySelector('.cta.secondary') as HTMLAnchorElement | null;
    expect(home?.getAttribute('href')).toBe('/en/');
  });

  it('renders a retry CTA pointing at the safe same-origin `from` value', async () => {
    const fixture = await renderError({ locale: 'en', from: '/en/catalog' });
    const root = fixture.nativeElement as HTMLElement;
    const retry = root.querySelector('.cta.primary') as HTMLAnchorElement | null;
    expect(retry?.getAttribute('href')).toBe('/en/catalog');
  });

  it('rejects a cross-origin `from` value and falls back to home only', async () => {
    const fixture = await renderError({ locale: 'en', from: 'https://evil.example/foo' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.cta')).toHaveLength(1);
    expect(root.querySelector('.cta')?.classList.contains('secondary')).toBe(true);
  });

  it('rejects a javascript: scheme `from` value', async () => {
    const fixture = await renderError({ locale: 'en', from: 'javascript:alert(1)' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.cta.primary')).toHaveLength(0);
  });

  it('rejects a protocol-relative `from` value (//evil.com)', async () => {
    const fixture = await renderError({ locale: 'en', from: '//evil.example/foo' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.cta.primary')).toHaveLength(0);
  });

  it('sets a localized title and noindex meta on init', async () => {
    await renderError({ locale: 'en', from: null });
    expect(document.title).toBe(
      `Something went wrong · ${fixtureChromeIdentity('demo', 'en').storeName}`,
    );
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const fixture = await renderError({ locale: 'en', from: '/en/catalog' });
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
        'landmark-one-main': { enabled: false },
        region: { enabled: false },
      },
    });
    const blocking = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
});
