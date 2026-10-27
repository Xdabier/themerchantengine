import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, attachToBody, renderComponent } from '../../ui/testing';
import { GuestContactComponent, type GuestContact } from './guest-contact.component';

function providers() {
  return [provideRouter([]), LocaleService];
}

function type(host: HTMLElement, testId: string, value: string): void {
  const input = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('GuestContactComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('always asks for an email, whatever requiredFields says', async () => {
    // The confirmation mail and the track-by-email challenge both key off it,
    // so a guest order without one is unreachable by its own buyer.
    const fixture = await renderComponent(
      GuestContactComponent,
      { requiredFields: [] },
      providers(),
    );
    expect(fixture.nativeElement.querySelector('[data-testid="guest-email"]')).not.toBeNull();
  });

  it('emits null until the email is valid, then emits the trimmed contact', async () => {
    const seen: (GuestContact | null)[] = [];
    const fixture = await renderComponent(
      GuestContactComponent,
      { requiredFields: ['email', 'phone'] },
      providers(),
    );
    fixture.componentInstance.contactChanged.subscribe((c: GuestContact | null) => seen.push(c));

    type(fixture.nativeElement, 'guest-email', 'not-an-email');
    fixture.detectChanges();
    expect(seen.at(-1)).toBeNull();

    type(fixture.nativeElement, 'guest-email', '  Buyer@Example.TEST ');
    fixture.detectChanges();
    expect(seen.at(-1)).toEqual({ email: 'buyer@example.test' });
  });

  it('renders company and note only when the operator listed them', async () => {
    const bare = await renderComponent(
      GuestContactComponent,
      { requiredFields: ['email', 'phone'] },
      providers(),
    );
    expect(bare.nativeElement.querySelector('[data-testid="guest-company"]')).toBeNull();
    expect(bare.nativeElement.querySelector('[data-testid="guest-note"]')).toBeNull();

    TestBed.resetTestingModule();
    const listed = await renderComponent(
      GuestContactComponent,
      { requiredFields: ['email', 'company', 'note'] },
      providers(),
    );
    expect(listed.nativeElement.querySelector('[data-testid="guest-company"]')).not.toBeNull();
    expect(listed.nativeElement.querySelector('[data-testid="guest-note"]')).not.toBeNull();
  });

  it('holds the contact back while a listed field is empty', async () => {
    // Listed means required, per the checkout-settings mapping. An operator
    // who asks for a company must not get an order without one.
    const seen: (GuestContact | null)[] = [];
    const fixture = await renderComponent(
      GuestContactComponent,
      { requiredFields: ['email', 'company'] },
      providers(),
    );
    fixture.componentInstance.contactChanged.subscribe((c: GuestContact | null) => seen.push(c));

    type(fixture.nativeElement, 'guest-email', 'buyer@example.test');
    fixture.detectChanges();
    expect(seen.at(-1)).toBeNull();

    type(fixture.nativeElement, 'guest-company', 'Acme Clinic');
    fixture.detectChanges();
    expect(seen.at(-1)).toEqual({ email: 'buyer@example.test', company: 'Acme Clinic' });
  });

  it('has no serious axe violations', async () => {
    const fixture = await renderComponent(
      GuestContactComponent,
      { requiredFields: ['email', 'company', 'note'] },
      providers(),
    );
    await assertAxeClean(attachToBody(fixture.nativeElement));
  });
});
