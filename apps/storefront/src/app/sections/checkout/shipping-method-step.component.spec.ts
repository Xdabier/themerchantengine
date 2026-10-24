import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ShippingMethodQuote } from '@storefront-types';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, attachToBody, renderComponent } from '../../ui/testing';
import { ShippingMethodStepComponent } from './shipping-method-step.component';
import { fixtureMoney } from '../../../test-support/store-config-fixtures';

/**
 * Money assertions run under the `maghreb-ltr` scenario fixture: a
 * three-decimal currency with the narrow no-break space as its group
 * separator. The precision is the load-bearing part, because a rule that only
 * breaks at three decimals passes untested under a two-decimal store.
 */
const FIXTURE_MONEY = fixtureMoney('maghreb-ltr');
const SYMBOL = FIXTURE_MONEY.symbol;

const rates: ShippingMethodQuote[] = [
  {
    methodId: 'sm-standard',
    name: 'Standard delivery',
    price: '8.000',
    isDefault: true,
    estimatedDaysMin: 2,
    estimatedDaysMax: 4,
  },
  {
    methodId: 'sm-express',
    name: 'Express delivery',
    price: '5.000',
    isDefault: false,
    estimatedDaysMin: 1,
    estimatedDaysMax: 1,
  },
];

function radiosOf(host: HTMLElement): HTMLInputElement[] {
  return [
    ...host.querySelectorAll('input[type="radio"][name="shipping-method"]'),
  ] as HTMLInputElement[];
}

function providers() {
  return [provideRouter([]), LocaleService];
}

describe('ShippingMethodStepComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders one radio per active method with its formatted price', async () => {
    const fixture = await renderComponent(
      ShippingMethodStepComponent,
      { rates, selectedMethodId: 'sm-standard' },
      providers(),
    );
    const radios = radiosOf(fixture.nativeElement);
    expect(radios.length).toBe(2);
    // Collapse ASCII runs only: the money format's U+00A0 and U+202F are part
    // of the assertion, and \s would eat both.
    const labels = [
      ...fixture.nativeElement.querySelectorAll('[data-testid^="shipping-method-option-"]'),
    ].map((el: Element) => el.textContent?.replace(/[ \t\n\r]+/g, ' ').trim());
    expect(labels[0]).toContain('Standard delivery');
    // The configured format: comma decimal, U+202F group, U+00A0 before the symbol.
    expect(labels[0]).toContain(`8,000${String.fromCodePoint(0x00a0)}${SYMBOL}`);
    expect(labels[1]).toContain('Express delivery');
    expect(labels[1]).toContain(`5,000${String.fromCodePoint(0x00a0)}${SYMBOL}`);
  });

  it('marks the selected method checked and emits the id on change', async () => {
    const fixture = await renderComponent(
      ShippingMethodStepComponent,
      { rates, selectedMethodId: 'sm-standard' },
      providers(),
    );
    const picked: string[] = [];
    fixture.componentInstance.methodSelected.subscribe((id: string) => picked.push(id));
    const radios = radiosOf(fixture.nativeElement);
    expect(radios[0].checked).toBe(true);
    radios[1].click();
    fixture.detectChanges();
    expect(picked).toEqual(['sm-express']);
  });

  it('renders a retry affordance instead of a silent default when the quote failed', async () => {
    const fixture = await renderComponent(
      ShippingMethodStepComponent,
      { rates: [], failed: true },
      providers(),
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="shipping-method-error"]'),
    ).not.toBeNull();
    expect(radiosOf(fixture.nativeElement).length).toBe(0);
    const retried: number[] = [];
    fixture.componentInstance.retryRequested.subscribe(() => retried.push(1));
    (
      fixture.nativeElement.querySelector('[data-testid="shipping-method-retry"]') as HTMLElement
    ).click();
    expect(retried.length).toBe(1);
  });

  it('says so when the destination has no method rather than showing an empty group', async () => {
    const fixture = await renderComponent(
      ShippingMethodStepComponent,
      { rates: [], failed: false, loading: false },
      providers(),
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="shipping-method-empty"]'),
    ).not.toBeNull();
  });

  it('has no serious axe violations', async () => {
    const fixture = await renderComponent(
      ShippingMethodStepComponent,
      { rates, selectedMethodId: 'sm-express' },
      providers(),
    );
    await assertAxeClean(attachToBody(fixture.nativeElement));
  });
});
