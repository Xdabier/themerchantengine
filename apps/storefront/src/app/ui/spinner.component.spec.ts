import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { SpinnerComponent } from './spinner.component';
import { assertAxeClean, renderComponent } from './testing';

describe('SpinnerComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders with role="status" and the default label', async () => {
    const fixture = await renderComponent(SpinnerComponent);
    const host = fixture.nativeElement as HTMLElement;
    const status = host.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-label')).toBe('Loading');
  });

  it.each(['sm', 'md', 'lg'] as const)('sizes %s applies the correct px', async (size) => {
    const fixture = await renderComponent(SpinnerComponent, { size });
    const span = fixture.nativeElement.querySelector('.spinner') as HTMLElement;
    const expected = { sm: 16, md: 24, lg: 32 }[size];
    expect(span.style.getPropertyValue('--spinner-size')).toBe(`${expected}px`);
  });

  it('uses a custom aria-label when label input changes', async () => {
    const fixture = await renderComponent(SpinnerComponent, { label: 'Chargement en cours' });
    const status = fixture.nativeElement.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-label')).toBe('Chargement en cours');
  });

  it('passes axe-core WCAG 2.2 AA', async () => {
    const fixture = await renderComponent(SpinnerComponent);
    await assertAxeClean(fixture.nativeElement);
  });
});
