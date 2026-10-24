import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type CardPadding = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" [class.elevated]="elevated()" [class]="paddingClass()">
      <ng-content select="[card-header]" />
      <ng-content />
      <ng-content select="[card-footer]" />
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .card {
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-lg);
      }
      .card.elevated {
        box-shadow: var(--brand-shadow-card);
      }
      .p-sm {
        padding: 1rem;
      }
      .p-md {
        padding: 1.5rem;
      }
      .p-lg {
        padding: 2rem;
      }
    `,
  ],
})
export class CardComponent {
  readonly padding = input<CardPadding>('md');
  readonly elevated = input<boolean>(false);

  protected readonly paddingClass = computed(() => `p-${this.padding()}`);
}
