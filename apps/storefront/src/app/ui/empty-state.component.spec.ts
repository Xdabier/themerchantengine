import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { EmptyStateComponent } from './empty-state.component';
import { assertAxeClean, renderComponent } from './testing';

@Component({
  standalone: true,
  imports: [EmptyStateComponent],
  template: `
    <app-empty-state heading="Your cart is empty." body="Start browsing.">
      <span empty-icon>📦</span>
      <button empty-cta type="button">Continue shopping</button>
    </app-empty-state>
  `,
})
class EmptyStateSlotsHost {}

describe('EmptyStateComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders heading + body', async () => {
    const fixture = await renderComponent(EmptyStateComponent, {
      heading: 'No results',
      body: 'Try a different search.',
    });
    expect(fixture.nativeElement.textContent).toContain('No results');
    expect(fixture.nativeElement.textContent).toContain('Try a different search.');
  });

  it('omits body element when body input is empty', async () => {
    const fixture = await renderComponent(EmptyStateComponent, { heading: 'No results' });
    expect(fixture.nativeElement.querySelector('.body')).toBeNull();
  });

  it('renders projected icon + CTA', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(EmptyStateSlotsHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('📦');
    expect(fixture.nativeElement.querySelector('button[empty-cta]')).not.toBeNull();
  });

  it('exposes role=status', async () => {
    const fixture = await renderComponent(EmptyStateComponent, { heading: 'No results' });
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(EmptyStateComponent, { heading: 'No results' });
    await assertAxeClean(fixture.nativeElement);
  });
});
