import { TestBed } from '@angular/core/testing';
import { Meta, Title } from '@angular/platform-browser';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import ServerErrorRootPage from './500.page';

describe('ServerErrorRootPage (locale-agnostic /500)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ServerErrorRootPage],
      providers: [Title, Meta],
    });
  });

  afterEach(() => {
    document.title = '';
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.remove();
  });

  it('renders bilingual stacked headings (French + English)', () => {
    const fixture = TestBed.createComponent(ServerErrorRootPage);
    fixture.detectChanges();
    const fr = fixture.nativeElement.querySelector('#server-error-heading-fr');
    const en = fixture.nativeElement.querySelector('#server-error-heading-en');
    expect(fr?.textContent?.trim()).toBe('Une erreur est survenue de notre côté');
    expect(en?.textContent?.trim()).toBe('Something went wrong on our end');
  });

  it('points each CTA at the matching locale home', () => {
    const fixture = TestBed.createComponent(ServerErrorRootPage);
    fixture.detectChanges();
    const links = fixture.nativeElement.querySelectorAll('a.cta');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/fr/');
    expect(links[1].getAttribute('href')).toBe('/en/');
  });

  it('sets bilingual title + noindex meta on init', () => {
    const fixture = TestBed.createComponent(ServerErrorRootPage);
    fixture.detectChanges();
    expect(document.title).toBe('Erreur serveur · Server error');
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute('content')).toBe('noindex, nofollow');
  });

  it('removes the noindex meta on destroy', () => {
    const fixture = TestBed.createComponent(ServerErrorRootPage);
    fixture.detectChanges();
    fixture.destroy();
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots).toBeNull();
  });

  it('does not inject any HttpClient or ApiClient (zero network dependency)', () => {
    const source = ServerErrorRootPage.toString();
    expect(source).not.toContain('HttpClient');
    expect(source).not.toContain('ApiClient');
  });

  it('passes axe-core WCAG 2.2 AA at the component scope', async () => {
    const fixture = TestBed.createComponent(ServerErrorRootPage);
    fixture.detectChanges();
    const result = await axe.run(fixture.nativeElement, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      rules: {
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
