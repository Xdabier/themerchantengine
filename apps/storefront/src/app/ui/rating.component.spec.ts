import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { RatingComponent } from './rating.component';
import { assertAxeClean, renderComponent } from './testing';

describe('RatingComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when count=0 (agent_docs/storefront/brand-tokens.md no-rating-when-zero)', async () => {
    const fixture = await renderComponent(RatingComponent, { value: 0, count: 0 });
    expect(fixture.nativeElement.querySelector('.rating')).toBeNull();
  });

  it('renders 5 stars + count + role=img + aria-label when count > 0', async () => {
    const fixture = await renderComponent(RatingComponent, { value: 4.3, count: 27 });
    const rating = fixture.nativeElement.querySelector('.rating');
    expect(rating).not.toBeNull();
    expect(rating?.getAttribute('role')).toBe('img');
    expect(rating?.getAttribute('aria-label')).toContain('4.3');
    expect(rating?.getAttribute('aria-label')).toContain('27');
    expect(fixture.nativeElement.querySelectorAll('.star').length).toBe(5);
  });

  it('fills full stars + partial fill for fractional value', async () => {
    const fixture = await renderComponent(RatingComponent, { value: 3.5, count: 10 });
    const stars = fixture.nativeElement.querySelectorAll('.star') as NodeListOf<HTMLElement>;
    expect(stars[0].style.getPropertyValue('--fill')).toBe('100%');
    expect(stars[1].style.getPropertyValue('--fill')).toBe('100%');
    expect(stars[2].style.getPropertyValue('--fill')).toBe('100%');
    expect(stars[3].style.getPropertyValue('--fill')).toBe('50%');
    expect(stars[4].style.getPropertyValue('--fill')).toBe('0%');
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(RatingComponent, { value: 4, count: 5 });
    await assertAxeClean(fixture.nativeElement);
  });
});
