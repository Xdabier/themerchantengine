import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { RadioGroupComponent, type RadioOption } from './radio.component';
import { assertAxeClean, renderComponent } from './testing';

const options: RadioOption[] = [
  { value: 'cod', label: 'Cash on Delivery' },
  { value: 'card', label: 'Credit Card', disabled: true },
];

describe('RadioGroupComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders a fieldset group with all radio options', async () => {
    const fixture = await renderComponent(RadioGroupComponent, {
      options,
      legend: 'Payment',
    });
    const fieldset = fixture.nativeElement.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    // <fieldset> carries implicit ARIA role="group"; do not duplicate via role="radiogroup".
    expect(fixture.nativeElement.querySelector('[role="radiogroup"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('input[type=radio]').length).toBe(2);
  });

  it('renders legend element', async () => {
    const fixture = await renderComponent(RadioGroupComponent, {
      options,
      legend: 'Payment',
    });
    expect(fixture.nativeElement.querySelector('legend')?.textContent).toContain('Payment');
  });

  it('disables individual options + reflects via input.disabled', async () => {
    const fixture = await renderComponent(RadioGroupComponent, { options });
    const inputs = fixture.nativeElement.querySelectorAll(
      'input[type=radio]',
    ) as NodeListOf<HTMLInputElement>;
    expect(inputs[0].disabled).toBe(false);
    expect(inputs[1].disabled).toBe(true);
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(RadioGroupComponent, {
      options,
      legend: 'Payment',
    });
    await assertAxeClean(fixture.nativeElement);
  });

  it('updates the selected value through CVA onChange when a radio fires change', async () => {
    const fixture = await renderComponent(RadioGroupComponent, {
      options,
      legend: 'Payment',
    });
    let captured: unknown = null;
    fixture.componentInstance.registerOnChange((v) => (captured = v));
    const inputs = fixture.nativeElement.querySelectorAll(
      'input[type=radio]',
    ) as NodeListOf<HTMLInputElement>;
    inputs[0].dispatchEvent(new Event('change'));
    expect(captured).toBe('cod');
    fixture.detectChanges();
    expect(inputs[0].checked).toBe(true);
  });
});
