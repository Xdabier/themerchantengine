import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AdminUser } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { TopbarAccountMenuComponent } from './topbar-account-menu.component';

expect.extend(toHaveNoViolations);

describe('TopbarAccountMenuComponent', () => {
  let fixture: ComponentFixture<TopbarAccountMenuComponent>;

  function configure(user: Partial<AdminUser> | null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
      ],
    });
    if (user) {
      TestBed.inject(AuthStore).setSession({
        user: {
          id: 'u-1',
          email: 'sara@example.com',
          roles: [],
          permissions: [],
          status: 'active',
          ...user,
        } as AdminUser,
      });
    }
    fixture = TestBed.createComponent(TopbarAccountMenuComponent);
    fixture.detectChanges();
  }

  function trigger(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid=topbar-account]') as HTMLButtonElement;
  }

  function menu(): HTMLElement | null {
    return document.querySelector('[data-testid=topbar-account-menu]');
  }

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('names the operator on the trigger', () => {
    configure({ firstName: 'Sara', lastName: 'Hassan' });
    expect(trigger().textContent?.trim()).toContain('Sara Hassan');
  });

  it('falls back to the email when no name is on file', () => {
    configure({ firstName: null, lastName: null });
    expect(trigger().textContent?.trim()).toContain('sara@example.com');
    expect(trigger().textContent).not.toContain('u-1');
  });

  it('falls back to a neutral label with no session', () => {
    configure(null);
    expect(trigger().textContent?.trim()).toContain('Account');
  });

  it('declares itself as a menu trigger', () => {
    configure({ firstName: 'Sara' });
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
  });

  it('opens to the profile and two-factor routes', () => {
    configure({ firstName: 'Sara' });
    trigger().click();
    fixture.detectChanges();
    const profile = menu()?.querySelector('[data-testid=topbar-account-profile]');
    const security = menu()?.querySelector('[data-testid=topbar-account-security]');
    expect(profile?.getAttribute('href')).toBe('/me');
    expect(security?.getAttribute('href')).toBe('/me/security');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    configure({ firstName: 'Sara' });
    trigger().click();
    fixture.detectChanges();
    expect(menu()).not.toBeNull();

    // CDK menu still reads the legacy `keyCode`, which jsdom leaves at 0.
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    Object.defineProperty(escape, 'keyCode', { get: () => 27 });
    menu()!.dispatchEvent(escape);
    fixture.detectChanges();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('has no axe violations while open', async () => {
    configure({ firstName: 'Sara' });
    trigger().click();
    fixture.detectChanges();
    const results = await axe(menu()!);
    expect(results).toHaveNoViolations();
  });
});
