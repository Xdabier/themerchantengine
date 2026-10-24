import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LocaleService } from '../../locale.service';
import type { ProductCardData } from '../../ui/product-card.component';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { ProductGridComponent, type ProductGridCardClick } from './product-grid.component';

const baseItem = (slug: string): ProductCardData => ({
  slug,
  title: `Product ${slug}`,
  href: `/en/catalog/product/${slug}`,
  imageSrc: `https://cdn.example/${slug}.jpg`,
  imageAlt: `Product ${slug}`,
  price: 199,
  currency: 'LYD',
  availability: 'IN_STOCK',
});

describe('ProductGridComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders cards in a list when items are provided', async () => {
    const fixture = await renderComponent(
      ProductGridComponent,
      { items: [baseItem('a'), baseItem('b'), baseItem('c')] },
      [provideRouter([]), LocaleService],
    );
    const cards = fixture.nativeElement.querySelectorAll('app-product-card');
    expect(cards.length).toBe(3);
    const grid = fixture.nativeElement.querySelector('[data-testid="catalog-grid"]');
    expect(grid).not.toBeNull();
  });

  it('renders the empty state when items is an empty array', async () => {
    const fixture = await renderComponent(ProductGridComponent, { items: [] }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-grid-empty"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="catalog-grid"]')).toBeNull();
  });

  it('renders skeleton placeholders when loading is true', async () => {
    const fixture = await renderComponent(ProductGridComponent, { items: [], loading: true }, [
      provideRouter([]),
      LocaleService,
    ]);
    const skeletons = fixture.nativeElement.querySelectorAll('app-skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-grid-loading"]'),
    ).not.toBeNull();
  });

  it('passes axe in the empty state', async () => {
    const fixture = await renderComponent(ProductGridComponent, { items: [] }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement);
  });

  it('lets callers override the empty-state heading + body', async () => {
    const fixture = await renderComponent(
      ProductGridComponent,
      {
        items: [],
        emptyHeadingOverride: 'No matches',
        emptyBodyOverride: 'Try a different query.',
      },
      [provideRouter([]), LocaleService],
    );
    const empty = fixture.nativeElement.querySelector(
      '[data-testid="catalog-grid-empty"]',
    ) as HTMLElement;
    expect(empty.textContent).toContain('No matches');
    expect(empty.textContent).toContain('Try a different query.');
  });

  it('emits cardClick with slug + position when a cell is clicked', async () => {
    const fixture = await renderComponent(
      ProductGridComponent,
      { items: [baseItem('a'), baseItem('b'), baseItem('c')] },
      [provideRouter([]), LocaleService],
    );
    const received: ProductGridCardClick[] = [];
    fixture.componentInstance.cardClick.subscribe((event) => {
      received.push(event);
    });
    const cells = fixture.nativeElement.querySelectorAll(
      'li[data-product-slug]',
    ) as NodeListOf<HTMLElement>;
    expect(cells.length).toBe(3);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    cells[1].dispatchEvent(click);
    fixture.detectChanges();
    expect(received).toEqual([{ slug: 'b', position: 1, event: click }]);
  });

  it('emits cardClick with the cross-page index when items span multiple appended pages', async () => {
    const items = Array.from({ length: 26 }, (_, i) => baseItem(`p-${i}`));
    const fixture = await renderComponent(ProductGridComponent, { items }, [
      provideRouter([]),
      LocaleService,
    ]);
    const received: ProductGridCardClick[] = [];
    fixture.componentInstance.cardClick.subscribe((event) => {
      received.push(event);
    });
    const cells = fixture.nativeElement.querySelectorAll(
      'li[data-product-slug]',
    ) as NodeListOf<HTMLElement>;
    expect(cells.length).toBe(26);
    cells[24].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(received.map(({ slug, position }) => ({ slug, position }))).toEqual([
      { slug: 'p-24', position: 24 },
    ]);
  });

  it('mounts the load-more sentinel beneath the grid and keeps cards rendered while loadingMore=true', async () => {
    const fixture = await renderComponent(
      ProductGridComponent,
      {
        items: [baseItem('a'), baseItem('b'), baseItem('c')],
        loadingMore: true,
        hasMore: true,
      },
      [provideRouter([]), LocaleService],
    );
    expect(fixture.nativeElement.querySelector('[data-testid="catalog-grid"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('app-product-card').length).toBe(3);
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-load-more-sentinel"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-load-more-skeleton"]'),
    ).not.toBeNull();
  });

  it('does not mount the sentinel while loading=true (full reset state)', async () => {
    const fixture = await renderComponent(
      ProductGridComponent,
      { items: [], loading: true, hasMore: true },
      [provideRouter([]), LocaleService],
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-load-more-sentinel"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-grid-loading"]'),
    ).not.toBeNull();
  });

  it('does not mount the sentinel when items is empty (empty-state owns the layout)', async () => {
    const fixture = await renderComponent(ProductGridComponent, { items: [], hasMore: false }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-load-more-sentinel"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-grid-empty"]'),
    ).not.toBeNull();
  });

  it('forwards loadMore from the sentinel to its own loadMore output', async () => {
    const fixture = await renderComponent(
      ProductGridComponent,
      {
        items: [baseItem('a'), baseItem('b')],
        hasMore: true,
        loadingMore: false,
      },
      [provideRouter([]), LocaleService],
    );
    const emissions: number[] = [];
    fixture.componentInstance.loadMore.subscribe(() => emissions.push(1));
    const button = fixture.nativeElement.querySelector(
      '[data-testid="catalog-load-more-button"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.click();
    fixture.detectChanges();
    expect(emissions.length).toBe(1);
  });
});
