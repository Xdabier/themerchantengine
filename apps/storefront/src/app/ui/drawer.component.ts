import { isPlatformBrowser } from '@angular/common';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
} from '@angular/core';

export type DrawerSide = 'start' | 'end';

@Component({
  selector: 'app-drawer',
  standalone: true,
  imports: [CdkTrapFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="backdrop" (click)="dismiss()" aria-hidden="true"></div>
      <aside
        class="panel"
        [class.side-start]="side() === 'start'"
        [class.side-end]="side() === 'end'"
        cdkTrapFocus
        cdkTrapFocusAutoCapture
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="labelledBy() || null"
      >
        <ng-content />
      </aside>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background-color: var(--brand-scrim-modal);
        z-index: 50;
      }
      .panel {
        position: fixed;
        inset-block: 0;
        inline-size: min(420px, 88vw);
        background-color: var(--brand-surface);
        color: var(--brand-text);
        z-index: 51;
        padding: 1.25rem;
        overflow-y: auto;
        box-shadow: var(--brand-shadow-drawer);
        animation: slide-in var(--brand-motion-duration) var(--brand-motion-easing);
      }
      .side-start {
        inset-inline-start: 0;
        inset-inline-end: auto;
      }
      .side-end {
        inset-inline-start: auto;
        inset-inline-end: 0;
      }
      @keyframes slide-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel {
          animation: none;
        }
      }
    `,
  ],
})
export class DrawerComponent {
  readonly open = input<boolean>(false);
  readonly side = input<DrawerSide>('end');
  readonly labelledBy = input<string>('');

  readonly closed = output<void>();

  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    /**
     * The panel is fixed and full height, so without this a swipe that runs
     * past the end of its own content scrolls the document underneath and the
     * visitor comes back to a drawer floating over somewhere else.
     */
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      document.body.style.overflow = this.open() ? 'hidden' : '';
    });
    // Destroyed while open (a route change tearing the host down) would
    // otherwise leave the document permanently unscrollable.
    this.destroyRef.onDestroy(() => {
      if (isPlatformBrowser(this.platformId)) document.body.style.overflow = '';
    });
  }

  protected dismiss(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) this.dismiss();
  }
}
