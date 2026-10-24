import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { signal } from '@angular/core';
import type { RouterStateSnapshot } from '@angular/router';
import { StoreSettingsStore } from './stores/store-settings.store';
import { StoreTitleStrategy, UNNAMED_STORE_TITLE } from './store-title-strategy';

/** A snapshot shaped like the one the router hands the strategy. */
function snapshotOf(...titles: Array<string | undefined>): RouterStateSnapshot {
  const nodes = titles.map((title) => ({
    data: title === undefined ? {} : { title },
    firstChild: null as unknown,
  }));
  nodes.forEach((node, i) => (node.firstChild = nodes[i + 1] ?? null));
  return { root: nodes[0] } as unknown as RouterStateSnapshot;
}

describe('StoreTitleStrategy', () => {
  let storeName: ReturnType<typeof signal<string>>;
  let title: Title;

  function setup(): StoreTitleStrategy {
    TestBed.configureTestingModule({
      providers: [StoreTitleStrategy, { provide: StoreSettingsStore, useValue: { storeName } }],
    });
    title = TestBed.inject(Title);
    const strategy = TestBed.inject(StoreTitleStrategy);
    TestBed.flushEffects();
    return strategy;
  }

  beforeEach(() => {
    storeName = signal('Demo Store');
  });

  it('puts the store name after the screen name', () => {
    const strategy = setup();
    strategy.updateTitle(snapshotOf(undefined, 'Settings'));
    TestBed.flushEffects();
    expect(title.getTitle()).toBe('Settings · Demo Store');
  });

  it('takes the innermost screen name on the activated path', () => {
    const strategy = setup();
    strategy.updateTitle(snapshotOf(undefined, 'Settings', 'Locales'));
    TestBed.flushEffects();
    expect(title.getTitle()).toBe('Locales · Demo Store');
  });

  it('keeps the nearest ancestor title when the leaf declares none', () => {
    const strategy = setup();
    strategy.updateTitle(snapshotOf(undefined, 'Settings', undefined));
    TestBed.flushEffects();
    expect(title.getTitle()).toBe('Settings · Demo Store');
  });

  it('shows the store name alone when no route declares one', () => {
    const strategy = setup();
    strategy.updateTitle(snapshotOf(undefined));
    TestBed.flushEffects();
    expect(title.getTitle()).toBe('Demo Store');
  });

  it('re-titles the current screen when the store name arrives late', () => {
    // The name comes from an authenticated request that finishes after the
    // first navigation. Writing the title once per navigation would leave the
    // landing screen unnamed for the rest of the session.
    storeName = signal('');
    const strategy = setup();
    strategy.updateTitle(snapshotOf(undefined, 'Dashboard'));
    TestBed.flushEffects();
    expect(title.getTitle()).toBe(`Dashboard · ${UNNAMED_STORE_TITLE}`);

    storeName.set('Demo Store');
    TestBed.flushEffects();
    expect(title.getTitle()).toBe('Dashboard · Demo Store');
  });

  it('does not render a blank store name as an empty tab', () => {
    storeName = signal('   ');
    const strategy = setup();
    strategy.updateTitle(snapshotOf(undefined, 'Orders'));
    TestBed.flushEffects();
    expect(title.getTitle()).toBe(`Orders · ${UNNAMED_STORE_TITLE}`);
  });
});
