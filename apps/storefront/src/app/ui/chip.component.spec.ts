import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ChipComponent } from './chip.component';
import { assertAxeClean, renderComponent, attachToBody } from './testing';

describe('ChipComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders without role when non-selectable', async () => {
    const fixture = await renderComponent(ChipComponent);
    expect(fixture.nativeElement.querySelector('.chip')?.getAttribute('role')).toBeNull();
  });

  it('exposes role=button + aria-pressed when selectable', async () => {
    const fixture = await renderComponent(ChipComponent, { selectable: true });
    const chip = fixture.nativeElement.querySelector('.chip');
    expect(chip?.getAttribute('role')).toBe('button');
    expect(chip?.getAttribute('aria-pressed')).toBe('false');
  });

  it('emits toggled on click when selectable', async () => {
    const fixture = await renderComponent(ChipComponent, { selectable: true });
    const handler = vi.fn();
    fixture.componentInstance.toggled.subscribe(handler);
    (fixture.nativeElement.querySelector('.chip') as HTMLElement).click();
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('emits toggled on Enter when selectable', async () => {
    const fixture = await renderComponent(ChipComponent, { selectable: true });
    const handler = vi.fn();
    fixture.componentInstance.toggled.subscribe(handler);
    const chip = fixture.nativeElement.querySelector('.chip') as HTMLElement;
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('emits toggled on Space when selectable', async () => {
    const fixture = await renderComponent(ChipComponent, { selectable: true });
    const handler = vi.fn();
    fixture.componentInstance.toggled.subscribe(handler);
    const chip = fixture.nativeElement.querySelector('.chip') as HTMLElement;
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('reflects selected=true via aria-pressed', async () => {
    const fixture = await renderComponent(ChipComponent, { selectable: true, selected: true });
    expect(fixture.nativeElement.querySelector('.chip')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders remove button with aria-label when removable', async () => {
    const fixture = await renderComponent(ChipComponent, {
      removable: true,
      removeLabel: 'Retirer',
    });
    const remove = fixture.nativeElement.querySelector('.remove');
    expect(remove).not.toBeNull();
    expect(remove?.getAttribute('aria-label')).toBe('Retirer');
  });

  it('emits removed on remove click', async () => {
    const fixture = await renderComponent(ChipComponent, { removable: true });
    const handler = vi.fn();
    fixture.componentInstance.removed.subscribe(handler);
    (fixture.nativeElement.querySelector('.remove') as HTMLButtonElement).click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('passes axe on the rendered component', async () => {
    const fixture = await renderComponent(ChipComponent, { removable: true });
    const wrapper = attachToBody(fixture.nativeElement);
    await assertAxeClean(wrapper);
  });
});
