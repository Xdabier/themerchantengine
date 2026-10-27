import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingScale = 'display' | 'section' | 'subsection' | 'eyebrow';

const scaleClass: Record<HeadingScale, string> = {
  display: 'text-5xl md:text-7xl font-bold tracking-tight text-ink',
  section: 'text-3xl md:text-4xl font-bold tracking-tight text-ink',
  subsection: 'text-xl md:text-2xl font-medium tracking-tight text-ink',
  eyebrow: 'text-xs tracking-widest uppercase text-ink-muted',
};

@Component({
  selector: 'app-heading',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (level()) {
      @case (1) {
        <h1 [class]="scaleClass()"><ng-content></ng-content></h1>
      }
      @case (2) {
        <h2 [class]="scaleClass()"><ng-content></ng-content></h2>
      }
      @case (3) {
        <h3 [class]="scaleClass()"><ng-content></ng-content></h3>
      }
      @case (4) {
        <h4 [class]="scaleClass()"><ng-content></ng-content></h4>
      }
      @case (5) {
        <h5 [class]="scaleClass()"><ng-content></ng-content></h5>
      }
      @default {
        <h6 [class]="scaleClass()"><ng-content></ng-content></h6>
      }
    }
  `,
})
export class HeadingComponent {
  readonly level = input<HeadingLevel>(2);
  readonly scale = input<HeadingScale>('section');

  protected scaleClass(): string {
    return scaleClass[this.scale()];
  }
}
