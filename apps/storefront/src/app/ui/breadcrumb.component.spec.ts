import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { BreadcrumbComponent, type BreadcrumbItem } from './breadcrumb.component';
import { assertAxeClean, renderComponent } from './testing';

const items: BreadcrumbItem[] = [
  { label: 'Home', href: '/fr/' },
  { label: 'Catalog', href: '/fr/catalog/' },
  { label: 'Electronics', href: '/fr/catalog/electronics' },
  { label: 'Smartwatch X' },
];

describe('BreadcrumbComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders the chain with last item marked aria-current=page', async () => {
    const fixture = await renderComponent(BreadcrumbComponent, { items });
    const lis = fixture.nativeElement.querySelectorAll('li');
    expect(lis.length).toBe(4);
    const current = fixture.nativeElement.querySelector('[aria-current="page"]');
    expect(current?.textContent?.trim()).toBe('Smartwatch X');
  });

  it('renders ›-glyph separator between non-last items', async () => {
    const fixture = await renderComponent(BreadcrumbComponent, { items });
    const seps = fixture.nativeElement.querySelectorAll('.sep') as NodeListOf<HTMLElement>;
    expect(seps.length).toBe(3);
    seps.forEach((s) => expect(s.textContent?.trim()).toBe('›'));
  });

  it('truncates middle to ellipsis BUTTON when maxVisible exceeded; clicking expands', async () => {
    const longItems: BreadcrumbItem[] = [
      { label: 'Home', href: '/' },
      { label: 'A', href: '/a' },
      { label: 'B', href: '/a/b' },
      { label: 'C', href: '/a/b/c' },
      { label: 'D', href: '/a/b/c/d' },
      { label: 'Leaf' },
    ];
    const fixture = await renderComponent(BreadcrumbComponent, { items: longItems, maxVisible: 3 });
    const ellipsis = fixture.nativeElement.querySelector('button.ellipsis') as HTMLButtonElement;
    expect(ellipsis).not.toBeNull();
    expect(ellipsis.getAttribute('aria-label')).toBe('Show all breadcrumb levels');
    expect(fixture.nativeElement.querySelectorAll('li').length).toBeLessThan(longItems.length);
    ellipsis.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button.ellipsis')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(longItems.length);
  });

  it('does not truncate when maxVisible=0', async () => {
    const fixture = await renderComponent(BreadcrumbComponent, { items });
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(items.length);
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(BreadcrumbComponent, { items });
    await assertAxeClean(fixture.nativeElement);
  });
});
