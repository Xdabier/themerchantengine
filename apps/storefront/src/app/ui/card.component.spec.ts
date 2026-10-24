import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CardComponent, type CardPadding } from './card.component';
import { assertAxeClean, renderComponent } from './testing';

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `
    <app-card [elevated]="true">
      <header card-header>Title</header>
      <p>Body content.</p>
      <footer card-footer>Footer</footer>
    </app-card>
  `,
})
class CardSlotsHost {}

describe('CardComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it.each(['sm', 'md', 'lg'] as const)(
    'applies p-%s padding class',
    async (padding: CardPadding) => {
      const fixture = await renderComponent(CardComponent, { padding });
      expect(fixture.nativeElement.querySelector('.card')?.classList.contains(`p-${padding}`)).toBe(
        true,
      );
    },
  );

  it('renders header / body / footer slots', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(CardSlotsHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Title');
    expect(fixture.nativeElement.textContent).toContain('Body content.');
    expect(fixture.nativeElement.textContent).toContain('Footer');
  });

  it('applies elevated class', async () => {
    const fixture = await renderComponent(CardComponent, { elevated: true });
    expect(fixture.nativeElement.querySelector('.card')?.classList.contains('elevated')).toBe(true);
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(CardComponent);
    await assertAxeClean(fixture.nativeElement);
  });
});
