import { TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ButtonComponent] }).compileComponents();
  });

  it('renders a <button> with default type=button', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.type).toBe('button');
  });

  it('disables the button when `disabled` is true', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
  });

  it('enters loading state: disables and sets aria-busy', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('emits click on user click', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
    const onClick = jest.fn();
    fixture.componentInstance.clicked.subscribe(onClick);
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies variant classes (primary)', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-surface-emphasis');
  });

  it('applies variant classes (destructive)', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('variant', 'destructive');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(btn.className).toContain('bg-status-error-fill');
  });

  it('applies fullWidth class when set', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('fullWidth', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').className).toContain('w-full');
  });

  // ── QA C5: a disabled control must be categorically different, not dimmer ───

  function classFor(variant: string): string {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
    return (fixture.nativeElement.querySelector('button') as HTMLButtonElement).className;
  }

  it('states the disabled treatment in tokens instead of a blanket dim', () => {
    for (const variant of ['primary', 'secondary', 'destructive', 'ghost']) {
      const cls = classFor(variant);
      // 50 % opacity turned the emphasis border into a mid grey that matches
      // the `--line` chrome, so a disabled pager still read as idle.
      expect(cls).not.toContain('disabled:opacity-50');
      expect(cls).toContain('disabled:bg-surface');
      expect(cls).toContain('disabled:text-ink-muted');
      expect(cls).toContain('disabled:border-line');
      expect(cls).toContain('disabled:cursor-not-allowed');
    }
  });

  it('kills the border and the hover affordance while disabled', () => {
    const secondary = classFor('secondary');
    expect(secondary).toContain('disabled:border-line');
    // Hover styles must not fire on a control that cannot be pressed.
    expect(secondary).toContain('enabled:hover:bg-surface-elevated');
    expect(secondary).not.toMatch(/(^|\s)hover:bg-surface-elevated/);

    const primary = classFor('primary');
    expect(primary).toContain('enabled:hover:bg-surface-emphasis-hover');
    expect(primary).not.toMatch(/(^|\s)hover:bg-surface-emphasis-hover/);
  });
});
