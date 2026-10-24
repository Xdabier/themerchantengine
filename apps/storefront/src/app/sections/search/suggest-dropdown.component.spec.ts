import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { SuggestItem } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent, attachToBody } from '../../ui/testing';
import { SuggestDropdownComponent, type SuggestSelectPayload } from './suggest-dropdown.component';

const ITEMS: SuggestItem[] = [
  { label: 'Headphones', productId: 'p-1' },
  { label: 'Tablet', slug: 'tablet' },
  { label: 'Coffee maker', productId: 'p-3' },
];

describe('SuggestDropdownComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders one option per suggestion plus the view-all row when a query is set', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'cof', activeIndex: -1, isLoading: false, listboxId: 'lb-1' },
      [LocaleService],
    );
    const options = fixture.nativeElement.querySelectorAll(
      '[data-testid="suggest-option"]',
    ) as NodeListOf<HTMLElement>;
    expect(options.length).toBe(3);
    const viewAll = fixture.nativeElement.querySelector(
      '[data-testid="suggest-view-all"]',
    ) as HTMLElement;
    expect(viewAll).not.toBeNull();
    expect(viewAll.textContent).toContain('cof');
  });

  it('omits the view-all row when the query is empty', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: '', activeIndex: -1, isLoading: false, listboxId: 'lb-2' },
      [LocaleService],
    );
    expect(fixture.nativeElement.querySelector('[data-testid="suggest-view-all"]')).toBeNull();
  });

  it('mirrors aria-selected against activeIndex', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'a', activeIndex: 1, isLoading: false, listboxId: 'lb-3' },
      [LocaleService],
    );
    const options = fixture.nativeElement.querySelectorAll(
      '[data-testid="suggest-option"]',
    ) as NodeListOf<HTMLElement>;
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[2].getAttribute('aria-selected')).toBe('false');
    fixture.componentRef.setInput('activeIndex', 0);
    fixture.detectChanges();
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
  });

  it('shows a loading status row instead of options when isLoading is true', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: [], query: 'h', activeIndex: -1, isLoading: true, listboxId: 'lb-4' },
      [LocaleService],
    );
    expect(fixture.nativeElement.querySelector('[data-testid="suggest-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="suggest-option"]')).toBeNull();
  });

  it('shows an empty status when items is empty and not loading', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: [], query: 'qzqzqz', activeIndex: -1, isLoading: false, listboxId: 'lb-5' },
      [LocaleService],
    );
    expect(fixture.nativeElement.querySelector('[data-testid="suggest-empty"]')).not.toBeNull();
  });

  it('emits an item-kind select when an option is clicked', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'cof', activeIndex: -1, isLoading: false, listboxId: 'lb-6' },
      [LocaleService],
    );
    let received: SuggestSelectPayload | null = null;
    fixture.componentInstance.select.subscribe((p: SuggestSelectPayload) => {
      received = p;
    });
    const second = fixture.nativeElement.querySelectorAll(
      '[data-testid="suggest-option"]',
    )[1] as HTMLElement;
    second.click();
    expect(received).not.toBeNull();
    expect(received).toMatchObject({ kind: 'item', index: 1 });
    expect((received as unknown as { item: SuggestItem }).item.label).toBe('Tablet');
  });

  it('emits a view-all select when the view-all row is clicked', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'cof', activeIndex: -1, isLoading: false, listboxId: 'lb-7' },
      [LocaleService],
    );
    let received: SuggestSelectPayload | null = null;
    fixture.componentInstance.select.subscribe((p: SuggestSelectPayload) => {
      received = p;
    });
    (
      fixture.nativeElement.querySelector('[data-testid="suggest-view-all"]') as HTMLElement
    ).click();
    expect(received).toEqual({ kind: 'view-all' });
  });

  it('emits activate(index) on mouseenter so the keyboard cursor follows the pointer', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'a', activeIndex: -1, isLoading: false, listboxId: 'lb-8' },
      [LocaleService],
    );
    let lastActive: number | null = null;
    fixture.componentInstance.activate.subscribe((idx: number) => {
      lastActive = idx;
    });
    const third = fixture.nativeElement.querySelectorAll(
      '[data-testid="suggest-option"]',
    )[2] as HTMLElement;
    third.dispatchEvent(new Event('mouseenter'));
    expect(lastActive).toBe(2);
  });

  it('uses preventDefault on option mousedown so the host input keeps focus', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'a', activeIndex: -1, isLoading: false, listboxId: 'lb-9' },
      [LocaleService],
    );
    const option = fixture.nativeElement.querySelector(
      '[data-testid="suggest-option"]',
    ) as HTMLElement;
    const event = new MouseEvent('mousedown', { cancelable: true, bubbles: true });
    option.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('passes axe with a labelled listbox + options', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'a', activeIndex: 0, isLoading: false, listboxId: 'lb-10' },
      [LocaleService],
    );
    await assertAxeClean(fixture.nativeElement);
  });

  it('passes axe on the attached fixture', async () => {
    const fixture = await renderComponent(
      SuggestDropdownComponent,
      { items: ITEMS, query: 'a', activeIndex: 1, isLoading: false, listboxId: 'lb-11' },
      [LocaleService],
    );
    const wrapper = attachToBody(fixture.nativeElement);
    await assertAxeClean(wrapper);
  });
});
