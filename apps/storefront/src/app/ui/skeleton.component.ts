import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SkeletonVariant = 'text' | 'image' | 'card';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="skel"
      role="status"
      [class]="variantClass()"
      [style.aspect-ratio]="aspectRatio()"
      [attr.aria-busy]="'true'"
      [attr.aria-live]="'polite'"
      [attr.aria-label]="label()"
    >
      @if (variant() === 'card') {
        <div class="image"></div>
        <div class="line"></div>
        <div class="line short"></div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      /* Brand floor §7.2: nothing pulses. The loading state reads through
         its flat ground, its shape, and its live region, never through an
         infinite animation. */
      .skel {
        background-color: var(--brand-surface-strong);
        border-radius: var(--brand-radius-md);
      }
      .v-text {
        block-size: 1em;
        inline-size: 100%;
      }
      .v-image {
        inline-size: 100%;
      }
      .v-card {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.625rem;
      }
      .v-card .image {
        aspect-ratio: 1 / 1;
        background-color: var(--brand-border-strong);
        border-radius: var(--brand-radius-md);
      }
      .v-card .line {
        block-size: 12px;
        background-color: var(--brand-border-strong);
        border-radius: var(--brand-radius-sm);
      }
      .v-card .line.short {
        inline-size: 60%;
      }
    `,
  ],
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('text');
  readonly aspectRatio = input<string | null>(null);
  readonly label = input<string>('Loading');

  protected readonly variantClass = computed(() => `v-${this.variant()}`);
}
