import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import NotFoundRootPage from './404.page';

describe('NotFoundRootPage (locale-agnostic /404)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NotFoundRootPage],
      providers: [Title, Meta],
    });
  });

  afterEach(() => {
    document.title = '';
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.remove();
  });

  it('renders bilingual stacked headings (French + English)', () => {
    const fixture = TestBed.createComponent(NotFoundRootPage);
    fixture.detectChanges();
    const fr = fixture.nativeElement.querySelector('#not-found-heading-fr');
    const en = fixture.nativeElement.querySelector('#not-found-heading-en');
    expect(fr?.textContent?.trim()).toBe('Page introuvable');
    expect(en?.textContent?.trim()).toBe('Page not found');
  });

  it('points each CTA at the matching locale home', () => {
    const fixture = TestBed.createComponent(NotFoundRootPage);
    fixture.detectChanges();
    const links = fixture.nativeElement.querySelectorAll('a.cta');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/fr/');
    expect(links[1].getAttribute('href')).toBe('/en/');
  });

  it('sets bilingual title + noindex meta on init', () => {
    const fixture = TestBed.createComponent(NotFoundRootPage);
    fixture.detectChanges();
    expect(document.title).toBe('Page introuvable · Page not found');
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('removes the noindex meta on destroy', () => {
    const fixture = TestBed.createComponent(NotFoundRootPage);
    fixture.detectChanges();
    fixture.destroy();
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots).toBeNull();
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const fixture = TestBed.createComponent(NotFoundRootPage);
    fixture.detectChanges();
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
        // Two h1 elements is the documented bilingual stacking pattern:
        // each h1 belongs to a distinct lang-attributed block. Suppress
        // the page-has-heading-one rule at component scope.
        'page-has-heading-one': { enabled: false },
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
