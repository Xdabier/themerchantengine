import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeStore, type ThemePreference } from './theme.store';

/**
 * The store is the only thing between an operator's choice and what the
 * document renders, and every one of its failure modes is silent: a stored
 * value nobody wrote, a browser that throws on `localStorage`, a system
 * preference that changes while the tab is open. None of them raises.
 */
describe('ThemeStore', () => {
  let listeners: Array<(event: { matches: boolean }) => void>;
  let systemPrefersLight: boolean;
  let matchMediaAvailable: boolean;
  let storage: Map<string, string>;
  let storageThrows: boolean;

  const html = () => document.documentElement;

  function setup(): ThemeStore {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(ThemeStore);
    TestBed.flushEffects();
    return store;
  }

  function emitSystemChange(matches: boolean): void {
    systemPrefersLight = matches;
    for (const listener of listeners) listener({ matches });
    TestBed.flushEffects();
  }

  beforeEach(() => {
    listeners = [];
    systemPrefersLight = false;
    matchMediaAvailable = true;
    storage = new Map();
    storageThrows = false;
    html().removeAttribute('data-theme');

    jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (storageThrows) throw new Error('storage is not available');
      return storage.get(key) ?? null;
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (storageThrows) throw new Error('storage is not available');
      storage.set(key, value);
    });

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: matchMediaAvailable
        ? (query: string) => ({
            media: query,
            get matches() {
              return systemPrefersLight;
            },
            addEventListener: (_type: string, listener: (e: { matches: boolean }) => void) => {
              listeners.push(listener);
            },
            removeEventListener: () => undefined,
          })
        : undefined,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    html().removeAttribute('data-theme');
  });

  it('defaults to following the system and resolves an unset system to dark', () => {
    const store = setup();
    expect(store.preference()).toBe('system');
    expect(store.resolved()).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
  });

  it('resolves system to light when the system asks for light', () => {
    systemPrefersLight = true;
    const store = setup();
    expect(store.resolved()).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it.each<ThemePreference>(['dark', 'light', 'system'])(
    'restores the stored %s preference',
    (preference) => {
      storage.set(THEME_STORAGE_KEY, preference);
      expect(setup().preference()).toBe(preference);
    },
  );

  it('treats a stored value outside the three-valued set as absent', () => {
    storage.set(THEME_STORAGE_KEY, 'solarized');
    const store = setup();
    expect(store.preference()).toBe('system');
    expect(store.resolved()).toBe('dark');
  });

  it('persists a choice and mirrors it onto the document', () => {
    const store = setup();
    store.set('light');
    TestBed.flushEffects();
    expect(storage.get(THEME_STORAGE_KEY)).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('lets an explicit choice beat the system in both directions', () => {
    systemPrefersLight = true;
    const store = setup();
    expect(store.resolved()).toBe('light');

    store.set('dark');
    TestBed.flushEffects();
    expect(store.resolved()).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');

    store.set('system');
    TestBed.flushEffects();
    expect(store.resolved()).toBe('light');
  });

  it('follows a system change made while the tab is open', () => {
    const store = setup();
    expect(store.resolved()).toBe('dark');

    emitSystemChange(true);
    expect(store.resolved()).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('ignores a system change once the operator has chosen', () => {
    const store = setup();
    store.set('dark');
    TestBed.flushEffects();

    emitSystemChange(true);
    expect(store.resolved()).toBe('dark');
  });

  it('survives a browser that throws on storage', () => {
    // Private mode throws on read and on write. The preference is a
    // convenience; losing it must not cost the operator the admin.
    storageThrows = true;
    const store = setup();
    expect(store.preference()).toBe('system');
    expect(() => store.set('light')).not.toThrow();
    TestBed.flushEffects();
    expect(store.resolved()).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('survives a browser with no matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const store = setup();
    expect(store.resolved()).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
  });
});
