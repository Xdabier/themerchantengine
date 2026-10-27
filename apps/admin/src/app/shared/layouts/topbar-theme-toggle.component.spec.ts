import { TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ThemeStore } from '../../core/stores/theme.store';
import { TopbarThemeToggleComponent } from './topbar-theme-toggle.component';

expect.extend(toHaveNoViolations);

describe('TopbarThemeToggleComponent', () => {
  let set: jest.Mock;
  let resolved: 'dark' | 'light';

  function render() {
    TestBed.configureTestingModule({
      imports: [TopbarThemeToggleComponent],
      providers: [
        {
          provide: ThemeStore,
          useValue: { resolved: () => resolved, set },
        },
      ],
    });
    const fixture = TestBed.createComponent(TopbarThemeToggleComponent);
    fixture.detectChanges();
    return fixture;
  }

  const button = (fixture: ReturnType<typeof render>) =>
    fixture.nativeElement.querySelector('button') as HTMLButtonElement;

  beforeEach(() => {
    set = jest.fn();
    resolved = 'dark';
  });

  it('states the mode in words, not only in an icon', () => {
    // An icon alone leaves a screen-reader user with no way to know which
    // mode is active, and leaves everyone guessing which way the control
    // goes. The accessible name carries the mode it switches to.
    const el = button(render());
    expect(el.getAttribute('aria-label')).toBe('Switch to light mode');
    expect(el.textContent?.trim()).toBeTruthy();
  });

  it('names the other mode when the light one is active', () => {
    resolved = 'light';
    expect(button(render()).getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('does not claim a pressed state that contradicts its own name', () => {
    // The name describes the mode this switches TO. `aria-pressed` describes
    // whether the named thing is active. In light mode the two together would
    // announce "Switch to dark mode, pressed", which is the opposite of true.
    resolved = 'light';
    expect(button(render()).hasAttribute('aria-pressed')).toBe(false);
  });

  it('meets the 44 px tap-target floor', () => {
    expect(button(render()).className).toContain('min-h-[44px]');
  });

  it('commits an explicit choice rather than toggling the system preference', () => {
    // Clicking it means "I want this mode", not "follow my system again".
    button(render()).click();
    expect(set).toHaveBeenCalledWith('light');
  });

  it('switches back the other way', () => {
    resolved = 'light';
    button(render()).click();
    expect(set).toHaveBeenCalledWith('dark');
  });

  it('is reachable by keyboard as a real button', () => {
    const el = button(render());
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.hasAttribute('tabindex')).toBe(false);
  });

  it('has no axe violations', async () => {
    const fixture = render();
    expect(await axe(fixture.nativeElement)).toHaveNoViolations();
  });
});
