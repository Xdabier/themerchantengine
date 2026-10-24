import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { StepperComponent } from './stepper.component';
import { assertAxeClean, renderComponent } from './testing';

describe('StepperComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders a role=group with aria-label', async () => {
    const fixture = await renderComponent(StepperComponent, { groupLabel: 'Quantity' });
    const group = fixture.nativeElement.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Quantity');
  });

  it('renders increment/decrement buttons with aria-label + value with aria-live', async () => {
    const fixture = await renderComponent(StepperComponent);
    expect(fixture.nativeElement.querySelector('.increment')?.getAttribute('aria-label')).toBe(
      'Increase quantity',
    );
    expect(fixture.nativeElement.querySelector('.decrement')?.getAttribute('aria-label')).toBe(
      'Decrease quantity',
    );
    expect(fixture.nativeElement.querySelector('.value')?.getAttribute('aria-live')).toBe('polite');
  });

  it('starts at min by default and disables decrement at floor', async () => {
    const fixture = await renderComponent(StepperComponent, { min: 1 });
    expect(fixture.nativeElement.querySelector('.value')?.textContent?.trim()).toBe('1');
    const dec = fixture.nativeElement.querySelector('.decrement') as HTMLButtonElement;
    expect(dec.disabled).toBe(true);
  });

  it('disables increment at max ceiling', async () => {
    const fixture = await renderComponent(StepperComponent, { value: 3, max: 3 });
    const inc = fixture.nativeElement.querySelector('.increment') as HTMLButtonElement;
    expect(inc.disabled).toBe(true);
  });

  it('emits valueChange when incremented', async () => {
    const fixture = await renderComponent(StepperComponent, { value: 2, max: 5 });
    const handler = vi.fn();
    fixture.componentInstance.valueChange.subscribe(handler);
    (fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).click();
    expect(handler).toHaveBeenCalledWith(3);
  });

  it('emits valueChange when decremented', async () => {
    const fixture = await renderComponent(StepperComponent, { value: 3, min: 1, max: 5 });
    const handler = vi.fn();
    fixture.componentInstance.valueChange.subscribe(handler);
    (fixture.nativeElement.querySelector('.decrement') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(handler).toHaveBeenCalledWith(2);
  });

  it('shows the value input, not the last click, so a rejected change snaps back', async () => {
    // The stepper kept an internal signal that, once a click set it, overrode
    // the input for good. On CART_INSUFFICIENT_STOCK the cart refused the new
    // quantity and re-rendered the old one, but no input transition could
    // clear the override, so the row displayed a quantity the cart did not
    // hold until a full page reload.
    const fixture = await renderComponent(StepperComponent, { value: 2, min: 1, max: 99 });
    const handler = vi.fn();
    fixture.componentInstance.valueChange.subscribe(handler);
    (fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(handler).toHaveBeenCalledWith(3);
    expect(fixture.nativeElement.querySelector('.value')?.textContent?.trim()).toBe('2');
  });

  it('follows the value input when the parent confirms the new quantity', async () => {
    const fixture = await renderComponent(StepperComponent, { value: 2, min: 1, max: 99 });
    (fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).click();
    fixture.componentRef.setInput('value', 3);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.value')?.textContent?.trim()).toBe('3');
  });

  it('disables both buttons while a mutation is in flight', async () => {
    const fixture = await renderComponent(StepperComponent, {
      value: 3,
      min: 1,
      max: 99,
      disabled: true,
    });
    expect((fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((fixture.nativeElement.querySelector('.decrement') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('emits nothing while disabled, so a queued click cannot race the response', async () => {
    const fixture = await renderComponent(StepperComponent, {
      value: 3,
      min: 1,
      max: 99,
      disabled: true,
    });
    const handler = vi.fn();
    fixture.componentInstance.valueChange.subscribe(handler);
    (fixture.nativeElement.querySelector('.increment') as HTMLButtonElement).click();
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(StepperComponent);
    await assertAxeClean(fixture.nativeElement);
  });
});
