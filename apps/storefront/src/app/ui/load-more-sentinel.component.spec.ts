import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadMoreSentinelComponent } from './load-more-sentinel.component';
import { renderComponent } from './testing';

type ObserverCb = (entries: IntersectionObserverEntry[]) => void;

interface FakeObserverHandle {
  callback: ObserverCb;
  disconnect: ReturnType<typeof vi.fn>;
  observed: Element[];
  options: IntersectionObserverInit | undefined;
}

const observers: FakeObserverHandle[] = [];

class FakeIntersectionObserver {
  constructor(cb: ObserverCb, options?: IntersectionObserverInit) {
    const handle: FakeObserverHandle = {
      callback: cb,
      disconnect: vi.fn(),
      observed: [],
      options,
    };
    observers.push(handle);
    Object.assign(this, {
      observe: (target: Element) => handle.observed.push(target),
      unobserve: vi.fn(),
      disconnect: handle.disconnect,
      takeRecords: () => [],
      root: null,
      rootMargin: options?.rootMargin ?? '',
      thresholds: [],
    });
  }
}

function fireIntersection(handle: FakeObserverHandle, isIntersecting: boolean): void {
  const target = handle.observed[0] ?? document.createElement('div');
  handle.callback([
    {
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      target,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    } as IntersectionObserverEntry,
  ]);
}

describe('LoadMoreSentinelComponent', () => {
  const originalIO = (globalThis as unknown as { IntersectionObserver?: unknown })
    .IntersectionObserver;

  beforeEach(() => {
    observers.length = 0;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    if (originalIO === undefined) {
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    } else {
      (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
        originalIO as typeof IntersectionObserver;
    }
    observers.length = 0;
    TestBed.resetTestingModule();
  });

  it('emits loadMore on intersection when hasMore=true and loading=false', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: false,
      loadMoreLabel: 'Load more',
      loadingLabel: 'Loading more',
    });
    const emissions: number[] = [];
    fixture.componentInstance.loadMore.subscribe(() => emissions.push(1));
    expect(observers.length).toBe(1);
    fireIntersection(observers[0], true);
    expect(emissions.length).toBe(1);
  });

  it('does not emit loadMore on intersection when hasMore=false', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: false,
      loading: false,
    });
    const emissions: number[] = [];
    fixture.componentInstance.loadMore.subscribe(() => emissions.push(1));
    fireIntersection(observers[0], true);
    expect(emissions.length).toBe(0);
  });

  it('does not emit loadMore on intersection when loading=true', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: true,
    });
    const emissions: number[] = [];
    fixture.componentInstance.loadMore.subscribe(() => emissions.push(1));
    fireIntersection(observers[0], true);
    expect(emissions.length).toBe(0);
  });

  it('emits loadMore when the fallback button is clicked while hasMore=true and loading=false', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: false,
    });
    const emissions: number[] = [];
    fixture.componentInstance.loadMore.subscribe(() => emissions.push(1));
    const button = fixture.nativeElement.querySelector(
      '[data-testid="catalog-load-more-button"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.click();
    expect(emissions.length).toBe(1);
  });

  it('disables the fallback button while loading=true', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: true,
    });
    const button = fixture.nativeElement.querySelector(
      '[data-testid="catalog-load-more-button"]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('renders the skeleton row only when loading=true', async () => {
    const fixtureIdle = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: false,
    });
    expect(
      fixtureIdle.nativeElement.querySelector('[data-testid="catalog-load-more-skeleton"]'),
    ).toBeNull();
    TestBed.resetTestingModule();
    const fixtureLoading = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: true,
    });
    const skeleton = fixtureLoading.nativeElement.querySelector(
      '[data-testid="catalog-load-more-skeleton"]',
    );
    expect(skeleton).not.toBeNull();
    const cells = skeleton?.querySelectorAll('.cell') ?? [];
    expect(cells.length).toBe(8);
  });

  it('does not instantiate an IntersectionObserver on the server (PLATFORM_ID = server)', async () => {
    observers.length = 0;
    const fixture = await renderComponent(
      LoadMoreSentinelComponent,
      { hasMore: true, loading: false },
      [{ provide: PLATFORM_ID, useValue: 'server' }],
    );
    expect(observers.length).toBe(0);
    const emissions: number[] = [];
    fixture.componentInstance.loadMore.subscribe(() => emissions.push(1));
    expect(emissions.length).toBe(0);
  });

  it('disconnects the observer on destroy', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: false,
    });
    expect(observers.length).toBe(1);
    fixture.destroy();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });
});

/**
 * Finding C6 (plan L Phase L4).
 *
 * The fallback button was rendered on every grid and merely hidden and
 * disabled once every result was on screen, so a fully loaded catalogue still
 * carried a dead "Load more" control in its DOM.
 */
describe('LoadMoreSentinelComponent when nothing is left to load', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders no load-more button at all', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: false,
      loading: false,
      loadMoreLabel: 'Load more',
      loadingLabel: 'Loading',
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-load-more-button"]'),
    ).toBeNull();
  });

  it('renders the button while more results remain', async () => {
    const fixture = await renderComponent(LoadMoreSentinelComponent, {
      hasMore: true,
      loading: false,
      loadMoreLabel: 'Load more',
      loadingLabel: 'Loading',
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="catalog-load-more-button"]'),
    ).not.toBeNull();
  });
});
