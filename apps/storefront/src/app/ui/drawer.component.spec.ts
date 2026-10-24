import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { DrawerComponent } from './drawer.component';
import { assertAxeClean, renderComponent, attachToBody } from './testing';

describe('DrawerComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing when open=false', async () => {
    const fixture = await renderComponent(DrawerComponent, { open: false });
    expect(fixture.nativeElement.querySelector('.panel')).toBeNull();
  });

  it('renders panel with role=dialog + aria-modal when open=true', async () => {
    const fixture = await renderComponent(DrawerComponent, { open: true });
    const panel = fixture.nativeElement.querySelector('.panel');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
  });

  it.each(['start', 'end'] as const)('applies side-%s class', async (side) => {
    const fixture = await renderComponent(DrawerComponent, { open: true, side });
    expect(fixture.nativeElement.querySelector('.panel')?.classList.contains(`side-${side}`)).toBe(
      true,
    );
  });

  it('emits closed on backdrop click', async () => {
    const fixture = await renderComponent(DrawerComponent, { open: true });
    const handler = vi.fn();
    fixture.componentInstance.closed.subscribe(handler);
    (fixture.nativeElement.querySelector('.backdrop') as HTMLElement).click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits closed on document Escape when open', async () => {
    const fixture = await renderComponent(DrawerComponent, { open: true });
    const handler = vi.fn();
    fixture.componentInstance.closed.subscribe(handler);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('panel carries the logical side class that inset-inline places', async () => {
    const fixture = await renderComponent(DrawerComponent, { open: true, side: 'end' });
    const wrapper = attachToBody(fixture.nativeElement);
    const panel = wrapper.querySelector('.panel');
    expect(panel?.classList.contains('side-end')).toBe(true);
  });

  it('threads labelledBy through to aria-labelledby on the panel', async () => {
    const fixture = await renderComponent(DrawerComponent, {
      open: true,
      labelledBy: 'cart-drawer-title',
    });
    expect(fixture.nativeElement.querySelector('.panel')?.getAttribute('aria-labelledby')).toBe(
      'cart-drawer-title',
    );
  });

  /**
   * First consumer is the header catalogue menu (plan N5), on a phone. With the
   * document still scrollable behind a fixed full-height panel, a swipe that
   * runs past the end of the drawer's own list scrolls the page underneath and
   * the visitor comes back to a panel floating over somewhere else.
   */
  it('locks the document scroll while open and gives it back on close', async () => {
    const fixture = await renderComponent(DrawerComponent, { open: false });
    expect(document.body.style.overflow).toBe('');

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.body.style.overflow).toBe('hidden');

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.body.style.overflow).toBe('');
  });

  it('gives the scroll back when it is destroyed while still open', async () => {
    const fixture = await renderComponent(DrawerComponent, { open: true });
    await fixture.whenStable();
    expect(document.body.style.overflow).toBe('hidden');
    fixture.destroy();
    expect(document.body.style.overflow).toBe('');
  });

  it('passes axe when open with a labelled panel', async () => {
    const fixture = await renderComponent(DrawerComponent, {
      open: true,
      labelledBy: 'cart-drawer-title',
    });
    await assertAxeClean(fixture.nativeElement);
  });
});
