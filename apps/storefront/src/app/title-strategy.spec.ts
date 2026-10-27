import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot } from '@angular/router';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { LocaleService } from './locale.service';
import { LocaleAwareTitleStrategy } from './title-strategy';
import { getChromeStrings } from '../i18n';
import { META_TITLE_SEPARATOR } from '../lib/seo';
import { readStorefrontSource } from '../lib/source-text';

const EM_DASH = '—';

class StubLocaleService {
  readonly locale = () => 'en' as const;
  readonly strings = () => getChromeStrings('en');
}

const EMPTY_SNAPSHOT = {} as RouterStateSnapshot;

describe('LocaleAwareTitleStrategy', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        Title,
        LocaleAwareTitleStrategy,
        { provide: LocaleService, useValue: new StubLocaleService() },
      ],
    });
  });

  it('joins a route title to the base title with the shared separator', () => {
    const strategy = TestBed.inject(LocaleAwareTitleStrategy);
    vi.spyOn(strategy, 'buildTitle').mockReturnValue('Shop');
    strategy.updateTitle(EMPTY_SNAPSHOT);
    expect(TestBed.inject(Title).getTitle()).toBe(
      `Shop${META_TITLE_SEPARATOR}${getChromeStrings('en').meta.title}`,
    );
  });

  it('writes the base title alone when the route declares none', () => {
    const strategy = TestBed.inject(LocaleAwareTitleStrategy);
    vi.spyOn(strategy, 'buildTitle').mockReturnValue(undefined);
    strategy.updateTitle(EMPTY_SNAPSHOT);
    expect(TestBed.inject(Title).getTitle()).toBe(getChromeStrings('en').meta.title);
  });

  /**
   * The em-dash is not the app separator and no other surface uses it. Assert
   * over the source bytes so an editor that renders it as a plain dash cannot
   * let it back in (plan L, finding C2).
   */
  it('has no em-dash in its source', () => {
    const source = readStorefrontSource('src/app/title-strategy.ts');
    expect(source.includes(EM_DASH)).toBe(false);
  });
});
