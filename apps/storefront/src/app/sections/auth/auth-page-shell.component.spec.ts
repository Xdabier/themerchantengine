import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { AuthPageShellComponent } from './auth-page-shell.component';

@Component({
  standalone: true,
  imports: [AuthPageShellComponent],
  template: `
    <app-auth-page-shell heading="Sign in" subheading="Use your account">
      <form data-testid="form-body">
        <input aria-label="Email" type="email" />
      </form>
      <a shellFooter href="/fr/auth/register" data-testid="footer-link">Register</a>
    </app-auth-page-shell>
  `,
})
class HostComponent {}

describe('AuthPageShellComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('projects the body slot and the footer slot', async () => {
    const fixture = await renderComponent(HostComponent, {}, [provideRouter([]), LocaleService]);
    expect(fixture.nativeElement.querySelector('[data-testid="form-body"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="footer-link"]')).not.toBeNull();
  });

  it('renders the heading as an h1', async () => {
    const fixture = await renderComponent(AuthPageShellComponent, { heading: 'Welcome back' }, [
      provideRouter([]),
      LocaleService,
    ]);
    const h1 = fixture.nativeElement.querySelector('h1.heading') as HTMLElement;
    expect(h1?.textContent?.trim()).toBe('Welcome back');
  });

  it('omits the subheading paragraph when subheading is empty', async () => {
    const fixture = await renderComponent(AuthPageShellComponent, { heading: 'Reset password' }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('.subheading')).toBeNull();
  });

  it('renders zero serious or critical axe violations at the component scope', async () => {
    const fixture = await renderComponent(HostComponent, {}, [provideRouter([]), LocaleService]);
    await assertAxeClean(fixture.nativeElement, {
      // The standalone component sample carries no language attribute on the
      // host wrapper because LocaleService is the source of truth at runtime;
      // axe only flags this at the document level which the spec does not own.
      disabledRules: ['html-has-lang', 'landmark-one-main', 'region'],
    });
  });

  it('renders the brand lockup img with eager + sync + high resource hints', async () => {
    const fixture = await renderComponent(HostComponent, {}, [provideRouter([]), LocaleService]);
    const img = fixture.nativeElement.querySelector('img.lockup') as HTMLImageElement;
    expect(img).not.toBeNull();
    // S14.5 — auth pages are direct-navigation targets where the lockup is
    // the LCP candidate above the fold; resource hints flip to eager + sync
    // + high fetchpriority (a11y-auditor recommendation, S14 Step 6).
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('decoding')).toBe('sync');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    // 3.68:1 asset ratio: a 44px-tall lockup is 162px wide.
    expect(img.getAttribute('width')).toBe('162');
    expect(img.getAttribute('height')).toBe('44');
  });
});
