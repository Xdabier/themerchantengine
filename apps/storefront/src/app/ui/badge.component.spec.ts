import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BadgeComponent, type BadgeVariant } from './badge.component';
import { assertAxeClean, renderComponent } from './testing';

@Component({
  standalone: true,
  imports: [BadgeComponent],
  template: `<app-badge [variant]="v">In stock</app-badge>`,
})
class BadgeHost {
  v: BadgeVariant = 'success';
}

describe('BadgeComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  const variants: BadgeVariant[] = ['success', 'warning', 'error', 'neutral'];

  it.each(variants)('applies v-%s class', async (variant) => {
    const fixture = await renderComponent(BadgeComponent, { variant });
    expect(fixture.nativeElement.querySelector('.badge')?.classList.contains(`v-${variant}`)).toBe(
      true,
    );
  });

  it('projects content', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(BadgeHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('In stock');
  });

  it('passes axe-core', async () => {
    const fixture = await renderComponent(BadgeComponent, { variant: 'success' });
    await assertAxeClean(fixture.nativeElement);
  });
});
