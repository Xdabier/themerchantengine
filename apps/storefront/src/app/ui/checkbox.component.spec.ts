import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CheckboxComponent } from './checkbox.component';
import { assertAxeClean, renderComponent } from './testing';

@Component({
  standalone: true,
  imports: [CheckboxComponent],
  template: `<app-checkbox [checked]="true">I agree</app-checkbox>`,
})
class CheckboxLabelHost {}

describe('CheckboxComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders a checkbox with a programmatically associated label', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CheckboxLabelHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[type=checkbox]') as HTMLInputElement;
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.htmlFor).toBe(input.id);
    expect(input.checked).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('I agree');
  });

  it('reflects disabled', async () => {
    const fixture = await renderComponent(CheckboxComponent, { disabled: true });
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('reflects indeterminate', async () => {
    const fixture = await renderComponent(CheckboxComponent, { indeterminate: true });
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
  });

  it('reflects invalid via aria-invalid="true"', async () => {
    const fixture = await renderComponent(CheckboxComponent, { invalid: true });
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('emits change event payload through CVA onChange callback', async () => {
    TestBed.configureTestingModule({});
    const fixture = await renderComponent(CheckboxComponent);
    let captured: unknown = null;
    fixture.componentInstance.registerOnChange((v) => (captured = v));
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    expect(captured).toBe(true);
  });

  it('passes axe with a labeled host', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CheckboxLabelHost);
    fixture.detectChanges();
    await assertAxeClean(fixture.nativeElement);
  });
});
