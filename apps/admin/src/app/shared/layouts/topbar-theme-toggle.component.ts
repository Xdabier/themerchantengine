import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeStore } from '../../core/stores/theme.store';

/**
 * Colour-mode switch in the topbar (constitution §3.9, DR-31).
 *
 * A click is a statement, not a cycle: it commits the operator to the mode
 * they picked, so a later change to their system setting no longer moves the
 * admin under them. Returning to `system` is deliberate and not something a
 * one-click control should do by accident, so it is not on this button.
 *
 * The label carries the mode it switches TO, and it is text rather than an
 * icon alone, because an icon here has no direction anyone can guess.
 *
 * Deliberately no `aria-pressed`. This is an action button, not a state
 * toggle: the name describes the mode it switches to, so a pressed state
 * describing the mode currently active would contradict the name it is
 * attached to. In light mode it would have announced "Switch to dark mode,
 * pressed", which says the opposite of what is true.
 */
@Component({
  selector: 'app-topbar-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="inline-flex items-center min-h-[44px] px-2 md:px-3 text-xs tracking-widest uppercase border border-line text-ink-muted hover:text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
      [attr.aria-label]="'Switch to ' + target() + ' mode'"
      data-testid="topbar-theme-toggle"
      (click)="toggle()"
    >
      {{ target() }}
    </button>
  `,
})
export class TopbarThemeToggleComponent {
  private readonly theme = inject(ThemeStore);

  protected readonly isLight = computed(() => this.theme.resolved() === 'light');
  protected readonly target = computed(() => (this.isLight() ? 'dark' : 'light'));

  protected toggle(): void {
    this.theme.set(this.target());
  }
}
