import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty" role="status">
      <ng-content select="[empty-icon]" />
      <h2 class="heading">{{ heading() }}</h2>
      @if (body()) {
        <p class="body">{{ body() }}</p>
      }
      <div class="cta">
        <ng-content select="[empty-cta]" />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        padding-block: clamp(2rem, 6vw, 4rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
        text-align: center;
        color: var(--brand-text);
      }
      .heading {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
      }
      .body {
        margin: 0;
        max-inline-size: 40ch;
        color: var(--brand-text-muted);
        font-size: var(--brand-text-body);
      }
      .cta {
        margin-block-start: 0.5rem;
      }
    `,
  ],
})
export class EmptyStateComponent {
  readonly heading = input.required<string>();
  readonly body = input<string>('');
}
