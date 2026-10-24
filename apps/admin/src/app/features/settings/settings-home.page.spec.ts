import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SettingsHomePage } from './settings-home.page';

expect.extend(toHaveNoViolations);

describe('SettingsHomePage', () => {
  let fixture: ComponentFixture<SettingsHomePage>;

  function configure(perms: string[] = ['settings:view']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(SettingsHomePage);
    fixture.detectChanges();
  }

  it('renders enabled cards for settings:view permissions', () => {
    configure(['settings:view']);
    const general = fixture.nativeElement.querySelector('[data-testid=settings-card-general]');
    expect(general).toBeTruthy();
    // Integrations needs settings:manage — rendered as disabled.
    const disabled = fixture.nativeElement.querySelector(
      '[data-testid=settings-card-disabled-integrations]',
    );
    expect(disabled).toBeTruthy();
  });

  it('enables all cards when operator has settings:manage', () => {
    configure(['settings:view', 'settings:manage']);
    const integrations = fixture.nativeElement.querySelector(
      '[data-testid=settings-card-integrations]',
    );
    expect(integrations).toBeTruthy();
  });

  it('has no axe violations', async () => {
    configure(['settings:view']);
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
