import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { AuthStore } from './core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from './core/tokens';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: BOOTSTRAP_LOCALE, useValue: 'fr' }],
    }).compileComponents();
  });

  it('renders the router outlet (no brand chrome at root — moved to AppShell + pages)', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('propagates AuthStore.locale to documentElement.lang and sets dir from the registry', async () => {
    const store = TestBed.inject(AuthStore);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');

    store.setLocale('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('flips dir to rtl for a registry locale written right-to-left', async () => {
    const store = TestBed.inject(AuthStore);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    store.setLocale('ar');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    store.setLocale('fr');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.documentElement.dir).toBe('ltr');
  });

  it('falls back to ltr for a locale the registry does not know', async () => {
    const store = TestBed.inject(AuthStore);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    store.setLocale('xx');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.documentElement.dir).toBe('ltr');
  });
});
