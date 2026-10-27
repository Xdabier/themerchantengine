import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { BadgeComponent } from './badge/badge.component';
import { FormFieldComponent } from './form-field/form-field.component';
import { HeadingComponent } from './heading/heading.component';
import { InputComponent } from './input/input.component';
import { LabelComponent } from './label/label.component';
import { LinkComponent } from './link/link.component';
import { SkeletonComponent } from './skeleton/skeleton.component';
import { SpinnerComponent } from './spinner/spinner.component';
import { TextareaComponent } from './textarea/textarea.component';

describe('LabelComponent', () => {
  it('renders a <label> with for + required marker', () => {
    TestBed.configureTestingModule({ imports: [LabelComponent] });
    const fixture = TestBed.createComponent(LabelComponent);
    fixture.componentRef.setInput('for', 'email');
    fixture.componentRef.setInput('required', true);
    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('label');
    expect(label.getAttribute('for')).toBe('email');
    expect(fixture.nativeElement.querySelector('span[aria-hidden="true"]').textContent).toContain(
      '*',
    );
  });
});

describe('InputComponent', () => {
  it('writes through ControlValueAccessor', () => {
    TestBed.configureTestingModule({ imports: [InputComponent, FormsModule] });
    const fixture = TestBed.createComponent(InputComponent);
    fixture.detectChanges();
    fixture.componentInstance.writeValue('hello');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(el.value).toBe('hello');
  });

  it('applies invalid border + aria-invalid', () => {
    TestBed.configureTestingModule({ imports: [InputComponent] });
    const fixture = TestBed.createComponent(InputComponent);
    fixture.componentRef.setInput('invalid', true);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(el.className).toContain('border-status-error');
  });

  it('fires onChange on user input', () => {
    TestBed.configureTestingModule({ imports: [InputComponent] });
    const fixture = TestBed.createComponent(InputComponent);
    fixture.detectChanges();
    const changes: string[] = [];
    fixture.componentInstance.registerOnChange((v) => changes.push(v));
    const el = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    el.value = 'hi';
    el.dispatchEvent(new Event('input'));
    expect(changes).toEqual(['hi']);
  });
});

describe('TextareaComponent', () => {
  it('writes through ControlValueAccessor', () => {
    TestBed.configureTestingModule({ imports: [TextareaComponent, FormsModule] });
    const fixture = TestBed.createComponent(TextareaComponent);
    fixture.detectChanges();
    fixture.componentInstance.writeValue('paragraph');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('textarea').value).toBe('paragraph');
  });
});

describe('FormFieldComponent', () => {
  it('renders label + error takes precedence over hint', () => {
    TestBed.configureTestingModule({ imports: [FormFieldComponent] });
    const fixture = TestBed.createComponent(FormFieldComponent);
    fixture.componentRef.setInput('fieldId', 'email');
    fixture.componentRef.setInput('label', 'Email');
    fixture.componentRef.setInput('hint', 'Store contact email');
    fixture.componentRef.setInput('error', 'Invalid email');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Invalid email',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Store contact email');
    expect(fixture.componentInstance.describedBy()).toBe('email-error');
  });

  it('falls back to hint when no error', () => {
    TestBed.configureTestingModule({ imports: [FormFieldComponent] });
    const fixture = TestBed.createComponent(FormFieldComponent);
    fixture.componentRef.setInput('fieldId', 'slug');
    fixture.componentRef.setInput('hint', 'Lowercase, dashes');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Lowercase, dashes');
    expect(fixture.componentInstance.describedBy()).toBe('slug-hint');
  });
});

describe('HeadingComponent', () => {
  it('renders the requested level', () => {
    TestBed.configureTestingModule({ imports: [HeadingComponent] });
    const fixture = TestBed.createComponent(HeadingComponent);
    fixture.componentRef.setInput('level', 1);
    fixture.componentRef.setInput('scale', 'display');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('h1').className).toContain('text-5xl');
  });

  it('defaults to h2 + section scale', () => {
    TestBed.configureTestingModule({ imports: [HeadingComponent] });
    const fixture = TestBed.createComponent(HeadingComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2')).toBeTruthy();
  });
});

describe('BadgeComponent', () => {
  it('applies tone-specific classes', () => {
    TestBed.configureTestingModule({ imports: [BadgeComponent] });
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.componentRef.setInput('tone', 'warning');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('span').className).toContain(
      'bg-status-warning-tint',
    );
  });
});

describe('SpinnerComponent', () => {
  it('exposes role=status + aria-label', () => {
    TestBed.configureTestingModule({ imports: [SpinnerComponent] });
    const fixture = TestBed.createComponent(SpinnerComponent);
    fixture.componentRef.setInput('label', 'Saving');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('span');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-label')).toBe('Saving');
  });
});

describe('SkeletonComponent', () => {
  it('renders as aria-hidden', () => {
    TestBed.configureTestingModule({ imports: [SkeletonComponent] });
    const fixture = TestBed.createComponent(SkeletonComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('span[aria-hidden="true"]')).toBeTruthy();
  });
});

describe('LinkComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LinkComponent], providers: [provideRouter([])] });
  });

  it('renders an internal link when `to` is set', () => {
    const fixture = TestBed.createComponent(LinkComponent);
    fixture.componentRef.setInput('to', '/orders');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/orders');
  });

  it('marks external links with rel=noopener', () => {
    const fixture = TestBed.createComponent(LinkComponent);
    fixture.componentRef.setInput('href', 'https://example.com');
    fixture.componentRef.setInput('external', true);
    fixture.detectChanges();
    const a = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });
});
