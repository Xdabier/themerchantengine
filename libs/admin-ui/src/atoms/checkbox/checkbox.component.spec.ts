import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { CheckboxComponent } from './checkbox.component';

expect.extend(toHaveNoViolations);

describe('CheckboxComponent', () => {
  let fixture: ComponentFixture<CheckboxComponent>;
  let cmp: CheckboxComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CheckboxComponent] });
    fixture = TestBed.createComponent(CheckboxComponent);
    cmp = fixture.componentInstance;
    cmp.ariaLabel = 'Select item';
    fixture.detectChanges();
  });

  it('renders an unchecked native input by default', () => {
    const native = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(native).toBeTruthy();
    expect(native.checked).toBe(false);
    expect(native.indeterminate).toBe(false);
    expect(native.getAttribute('aria-label')).toBe('Select item');
  });

  it('emits a change event with the new checked state', () => {
    const spy = jest.fn();
    cmp.changed.subscribe(spy);
    const native = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    native.checked = true;
    native.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith(true);
  });

  it('syncs the indeterminate flag onto the DOM element', () => {
    cmp.indeterminate = true;
    cmp.ngOnChanges({
      indeterminate: {
        previousValue: false,
        currentValue: true,
        firstChange: false,
        isFirstChange: () => false,
      },
    });
    fixture.detectChanges();
    const native = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(native.indeterminate).toBe(true);
  });

  it('disables the native input when disabled is true', () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const native = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(native.disabled).toBe(true);
  });

  it('is a11y-clean in unchecked, checked, and indeterminate states', async () => {
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();

    cmp.checked = true;
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();

    cmp.indeterminate = true;
    cmp.ngOnChanges({
      indeterminate: {
        previousValue: false,
        currentValue: true,
        firstChange: false,
        isFirstChange: () => false,
      },
    });
    fixture.detectChanges();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
