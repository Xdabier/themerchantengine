import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Outer wrapper for a route's main content. Owns top/bottom padding. */
@Component({
  selector: 'app-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-6 py-8 md:px-10 md:py-12 max-w-[1600px] mx-auto">
      <ng-content></ng-content>
    </div>
  `,
})
export class PageComponent {
  readonly testid = input<string | null>(null);
}

/**
 * Header block: eyebrow + title + optional description + right-aligned actions slot.
 * Slot actions via `<ng-content select="[pageActions]">`.
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header
      class="flex flex-col md:flex-row md:items-end md:justify-between gap-6 pb-6 border-b border-line"
    >
      <div>
        @if (eyebrow()) {
          <p class="text-ink-muted text-xs tracking-widest uppercase">{{ eyebrow() }}</p>
        }
        <h1 class="mt-2 text-3xl md:text-5xl font-bold tracking-tight text-ink">
          {{ title() }}
        </h1>
        @if (description()) {
          <p class="mt-3 text-ink-muted max-w-xl">{{ description() }}</p>
        }
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <ng-content select="[pageActions]"></ng-content>
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly eyebrow = input<string | null>(null);
  readonly description = input<string | null>(null);
}

/** Section inside a page. Optional title + 1px top border + content body. */
@Component({
  selector: 'app-page-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mt-10 pt-10 border-t border-line first:border-t-0 first:pt-0 first:mt-10">
      @if (title()) {
        <h2 class="text-xl md:text-2xl font-medium tracking-tight text-ink">
          {{ title() }}
        </h2>
      }
      @if (description()) {
        <p class="mt-2 text-ink-muted max-w-xl">{{ description() }}</p>
      }
      <div class="mt-6">
        <ng-content></ng-content>
      </div>
    </section>
  `,
})
export class PageSectionComponent {
  readonly title = input<string | null>(null);
  readonly description = input<string | null>(null);
}

/**
 * Sticky action bar: desktop = flush right, mobile = sticky-bottom full-width.
 * Use for primary Save/Publish/Delete actions on detail routes.
 */
@Component({
  selector: 'app-page-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mt-10 md:mt-12 flex flex-wrap items-center justify-end gap-3 md:static md:bg-transparent md:border-0 md:px-0 sticky bottom-0 bg-surface border-t border-line -mx-6 px-6 py-4 md:mx-0 md:py-0"
    >
      <ng-content></ng-content>
    </div>
  `,
})
export class PageActionsComponent {}
