import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Section title with a primary rule beneath the heading, which the brand floor
 * is one of the primary's sanctioned uses. Used by every home section so the rule
 * is consistent. Callers
 * pass `headingId` so the parent `<section aria-labelledby="...">` references
 * the visible `<h2>` directly — no duplicate visually-hidden span needed.
 */
@Component({
  selector: 'app-section-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="header">
      @if (eyebrow()) {
        <p class="eyebrow">{{ eyebrow() }}</p>
      }
      <h2 class="title" [attr.id]="headingId() ?? null">{{ title() }}</h2>
      <span class="accent" aria-hidden="true"></span>
    </header>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .header {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.375rem;
        padding-block-end: 1rem;
      }
      .eyebrow {
        margin: 0;
        font-size: var(--brand-text-micro);
        font-weight: 600;
        color: var(--brand-primary);
      }
      .title {
        margin: 0;
        font-family: var(--brand-font-display);
        font-size: var(--brand-text-section);
        font-weight: 600;
        line-height: 1.2;
        color: var(--brand-text);
      }
      .accent {
        display: block;
        margin-block-start: 0.5rem;
        block-size: 3px;
        inline-size: 56px;
        background-color: var(--brand-primary);
        border-radius: var(--brand-radius-full);
      }
    `,
  ],
})
export class SectionHeaderComponent {
  readonly title = input.required<string>();
  readonly eyebrow = input<string | null>(null);
  readonly headingId = input<string | null>(null);
}
