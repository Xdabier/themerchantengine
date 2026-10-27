import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { StorefrontError, StorefrontUnauthorizedError } from '@storefront-types';

import { getChromeStrings } from '../../../i18n';
import { LocaleService } from '../../locale.service';
import { WishlistStateService } from '../../services/wishlist-state.service';
import { ToastService } from '../../ui/toast.component';
import { renderComponent } from '../../ui/testing';
import { WishlistToggleComponent, type WishlistToggleLabels } from './wishlist-toggle.component';

/**
 * Signal-backed stand-in for `WishlistStateService`. Signal-backed on purpose:
 * a plain `Set` would let `pressed` pass as a `computed()` over a non-reactive
 * read, which is exactly the shape this component must not have.
 */
function makeStore(members: string[] = [], overrides: Partial<Record<string, unknown>> = {}) {
  const ids = signal<ReadonlySet<string>>(new Set(members));
  const commit = (id: string, member: boolean) => {
    const next = new Set(ids());
    if (member) next.add(id);
    else next.delete(id);
    ids.set(next);
  };
  return {
    ids,
    isWishlisted: (id: string) => ids().has(id),
    add: vi.fn(async (id: string) => commit(id, true)),
    remove: vi.fn(async (id: string) => commit(id, false)),
    ...overrides,
  };
}

async function render(
  store: ReturnType<typeof makeStore>,
  productId = 'p-1',
  variant: 'inline' | 'overlay' = 'inline',
  labels?: WishlistToggleLabels,
) {
  return renderComponent(
    WishlistToggleComponent,
    labels ? { productId, variant, labels } : { productId, variant },
    [LocaleService, ToastService, { provide: WishlistStateService, useValue: store }],
  );
}

function rejectingStore(error: unknown, members: string[] = []) {
  return makeStore(members, {
    add: vi.fn(async () => {
      throw error;
    }),
    remove: vi.fn(async () => {
      throw error;
    }),
  });
}

function button(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
  return fixture.nativeElement.querySelector('button') as HTMLButtonElement;
}

describe('WishlistToggleComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  // The whole of finding W1: the toggle used to boot `signal(false)` with no
  // input and no fetch, so a wishlisted product showed an empty heart after
  // every reload and the next click silently re-added it.
  it('renders pressed on first paint for a product already in the store', async () => {
    const fixture = await render(makeStore(['p-1']));

    expect(button(fixture).getAttribute('aria-pressed')).toBe('true');
  });

  it('renders unpressed for a product the store does not hold', async () => {
    const fixture = await render(makeStore(['other']));

    expect(button(fixture).getAttribute('aria-pressed')).toBe('false');
  });

  it('follows the store when membership changes elsewhere on the page', async () => {
    const store = makeStore([]);
    const fixture = await render(store);
    expect(button(fixture).getAttribute('aria-pressed')).toBe('false');

    // Same product wishlisted from another surface (the wishlist page, the
    // cart's move-to-wishlist). This heart must follow without being told.
    await store.add('p-1');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(button(fixture).getAttribute('aria-pressed')).toBe('true');
  });

  // Routing every mutation through the store is what keeps the heart on the
  // card, the heart in the buy box and the wishlist page agreeing.
  it('adds through the store funnel, never through the API service directly', async () => {
    const store = makeStore([]);
    const fixture = await render(store);

    button(fixture).click();
    await fixture.whenStable();

    expect(store.add).toHaveBeenCalledWith('p-1');
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('removes through the store funnel when already pressed', async () => {
    const store = makeStore(['p-1']);
    const fixture = await render(store);

    button(fixture).click();
    await fixture.whenStable();

    expect(store.remove).toHaveBeenCalledWith('p-1');
    expect(store.add).not.toHaveBeenCalled();
  });

  it('keeps the accessible name in step with the pressed state', async () => {
    const pressedFixture = await render(makeStore(['p-1']));
    expect(pressedFixture.nativeElement.querySelector('button')?.getAttribute('aria-label')).toBe(
      TestBed.inject(LocaleService).strings().product.wishlist.remove,
    );

    TestBed.resetTestingModule();
    const idleFixture = await render(makeStore([]));
    expect(idleFixture.nativeElement.querySelector('button')?.getAttribute('aria-label')).toBe(
      TestBed.inject(LocaleService).strings().product.wishlist.add,
    );
  });

  // Finding W6 / W2 UI half. Every failure used to land in an `.sr-only` span,
  // so a sighted customer watched the heart fill, unfill, and got nothing.
  it('pushes a sign-in toast when an anonymous visitor clicks the heart', async () => {
    const store = rejectingStore(
      new StorefrontUnauthorizedError({ code: 'UNAUTHORIZED', message: 'no session' }),
    );
    const fixture = await render(store);
    const toasts = TestBed.inject(ToastService);

    button(fixture).click();
    await fixture.whenStable();

    const strings = TestBed.inject(LocaleService).strings();
    expect(toasts.toasts().map((t) => t.message)).toContain(strings.product.wishlist.signInToSave);
  });

  it('pushes the wishlist error toast on any other failure', async () => {
    const store = rejectingStore(
      new StorefrontError({ code: 'WISHLIST_PRODUCT_NOT_FOUND', message: 'gone', status: 404 }),
    );
    const fixture = await render(store);
    const toasts = TestBed.inject(ToastService);

    button(fixture).click();
    await fixture.whenStable();

    const strings = TestBed.inject(LocaleService).strings();
    expect(toasts.toasts().map((t) => t.message)).toContain(strings.product.wishlist.error);
    expect(toasts.toasts().map((t) => t.variant)).toContain('error');
  });

  it('reverts the pressed state after a failed add, with the store as the source', async () => {
    const store = rejectingStore(
      new StorefrontError({ code: 'BOOM', message: 'boom', status: 500 }),
    );
    const fixture = await render(store);

    button(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(button(fixture).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps announcing the outcome to screen readers as well as showing it', async () => {
    const store = rejectingStore(
      new StorefrontError({ code: 'BOOM', message: 'boom', status: 500 }),
    );
    const fixture = await render(store);

    button(fixture).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const status = fixture.nativeElement.querySelector(
      '[data-testid="wishlist-toggle-status"]',
    ) as HTMLElement;
    expect(status.textContent?.trim()).toBe(
      TestBed.inject(LocaleService).strings().product.wishlist.error,
    );
  });

  // The global 401 hook in app.config.ts owns login navigation. A second
  // redirect here would race it and drop the `?from=` it threads.
  it('never navigates on its own', async () => {
    const store = rejectingStore(
      new StorefrontUnauthorizedError({ code: 'UNAUTHORIZED', message: 'no session' }),
    );
    const fixture = await render(store);

    button(fixture).click();
    await fixture.whenStable();

    expect(fixture.componentInstance).not.toHaveProperty('router');
  });

  // Finding W5. In the buy box the control was a bare 20px glyph beside the
  // full-width Add-to-cart block: a fine 44px hit target that did not read as
  // a button to anyone looking at it.
  describe('inline variant affordance', () => {
    it('renders a visible label beside the icon', async () => {
      const fixture = await render(makeStore([]), 'p-1', 'inline');
      const label = fixture.nativeElement.querySelector('[data-testid="wishlist-toggle-label"]');
      expect(label?.textContent?.trim()).toBe(
        TestBed.inject(LocaleService).strings().product.wishlist.add,
      );
    });

    it('swaps the visible label with the pressed state', async () => {
      const fixture = await render(makeStore(['p-1']), 'p-1', 'inline');
      const label = fixture.nativeElement.querySelector('[data-testid="wishlist-toggle-label"]');
      expect(label?.textContent?.trim()).toBe(
        TestBed.inject(LocaleService).strings().product.wishlist.remove,
      );
    });

    // The visible label and the accessible name must not diverge, or a voice
    // user says what they see and nothing happens (WCAG 2.5.3).
    it('keeps the visible label and the accessible name identical', async () => {
      const fixture = await render(makeStore([]), 'p-1', 'inline');
      const label = fixture.nativeElement
        .querySelector('[data-testid="wishlist-toggle-label"]')
        ?.textContent?.trim();
      expect(button(fixture).getAttribute('aria-label')).toBe(label);
    });

    it('leaves the overlay variant icon-only, as the card grid needs', async () => {
      const fixture = await render(makeStore([]), 'p-1', 'overlay');
      expect(
        fixture.nativeElement.querySelector('[data-testid="wishlist-toggle-label"]'),
      ).toBeNull();
      expect(button(fixture).getAttribute('aria-label')).toBe(
        TestBed.inject(LocaleService).strings().product.wishlist.add,
      );
    });
  });

  /**
   * Finding P3, second half (plan N4). An out-of-stock product offered nothing
   * to do, even though the mail engine already fans a back-in-stock email out
   * to every wishlister of the product. The control is the same wishlist
   * toggle; only the words change, so the buy box overrides them rather than
   * a second component being built beside this one.
   */
  describe('label override (finding P3)', () => {
    const notifyLabels: WishlistToggleLabels = {
      add: 'Notify me when it is back',
      remove: 'Stop notifying me',
      added: 'We will email you when it is back in stock.',
      removed: 'You will no longer be notified about this product.',
    };

    it('uses the override for the accessible name, never the wishlist copy', async () => {
      const fixture = await render(makeStore(), 'p-1', 'inline', notifyLabels);
      const el = button(fixture);
      expect(el.getAttribute('aria-label')).toBe(notifyLabels.add);
      expect(el.getAttribute('aria-label')).not.toBe(getChromeStrings('fr').product.wishlist.add);
    });

    it('swaps the override with the pressed state', async () => {
      const fixture = await render(makeStore(['p-1']), 'p-1', 'inline', notifyLabels);
      expect(button(fixture).getAttribute('aria-label')).toBe(notifyLabels.remove);
    });

    it('shows the override as the visible inline label too', async () => {
      const fixture = await render(makeStore(), 'p-1', 'inline', notifyLabels);
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="wishlist-toggle-label"]')
          ?.textContent?.trim(),
      ).toBe(notifyLabels.add);
    });

    it('announces the override outcome after a successful add', async () => {
      const fixture = await render(makeStore(), 'p-1', 'inline', notifyLabels);
      button(fixture).click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="wishlist-toggle-status"]')
          ?.textContent?.trim(),
      ).toBe(notifyLabels.added);
    });

    it('leaves the wishlist copy untouched when no override is bound', async () => {
      const fixture = await render(makeStore());
      expect(button(fixture).getAttribute('aria-label')).toBe(
        getChromeStrings('fr').product.wishlist.add,
      );
    });
  });
});
