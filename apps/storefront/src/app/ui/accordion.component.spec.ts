import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AccordionComponent, AccordionItemComponent } from './accordion.component';
import { assertAxeClean, renderComponent } from './testing';

@Component({
  standalone: true,
  imports: [AccordionItemComponent],
  template: `
    <app-accordion-item heading="Shipping" [open]="true">
      <p>Free over 100 AED.</p>
    </app-accordion-item>
  `,
})
class AccordionHost {}

@Component({
  standalone: true,
  imports: [AccordionComponent, AccordionItemComponent],
  template: `
    <app-accordion [mode]="mode">
      <app-accordion-item id="a" heading="A">
        <p data-testid="a-body">A body</p>
      </app-accordion-item>
      <app-accordion-item id="b" heading="B">
        <p data-testid="b-body">B body</p>
      </app-accordion-item>
    </app-accordion>
  `,
})
class AccordionParentHost {
  mode: 'single' | 'multi' = 'single';
}

describe('AccordionItemComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders trigger with aria-expanded=true when open', async () => {
    const fixture = await renderComponent(AccordionItemComponent, {
      heading: 'Shipping',
      open: true,
    });
    const trigger = fixture.nativeElement.querySelector('.trigger');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders trigger with aria-expanded=false when closed', async () => {
    const fixture = await renderComponent(AccordionItemComponent, {
      heading: 'Shipping',
      open: false,
    });
    const trigger = fixture.nativeElement.querySelector('.trigger');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('hides body when closed (uses [hidden] attribute)', async () => {
    const fixture = await renderComponent(AccordionItemComponent, {
      heading: 'Shipping',
      open: false,
    });
    const body = fixture.nativeElement.querySelector('.body') as HTMLElement;
    expect(body.hidden).toBe(true);
  });

  it('emits toggled with !open on click', async () => {
    const fixture = await renderComponent(AccordionItemComponent, {
      heading: 'Shipping',
      open: false,
    });
    const handler = vi.fn();
    fixture.componentInstance.toggled.subscribe(handler);
    (fixture.nativeElement.querySelector('.trigger') as HTMLButtonElement).click();
    expect(handler).toHaveBeenCalledWith(true);
  });

  it('renders projected body content when open', () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(AccordionHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Free over 100 AED.');
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(AccordionItemComponent, {
      heading: 'Shipping',
      open: true,
    });
    await assertAxeClean(fixture.nativeElement);
  });

  describe('with AccordionComponent parent', () => {
    it('single mode: opening one item closes the previously open item', () => {
      TestBed.configureTestingModule({});
      const fixture = TestBed.createComponent(AccordionParentHost);
      fixture.detectChanges();
      const triggers = fixture.nativeElement.querySelectorAll(
        '.trigger',
      ) as NodeListOf<HTMLButtonElement>;
      triggers[0].click();
      fixture.detectChanges();
      expect(triggers[0].getAttribute('aria-expanded')).toBe('true');
      expect(triggers[1].getAttribute('aria-expanded')).toBe('false');
      triggers[1].click();
      fixture.detectChanges();
      expect(triggers[0].getAttribute('aria-expanded')).toBe('false');
      expect(triggers[1].getAttribute('aria-expanded')).toBe('true');
    });

    it('multi mode: multiple items can be open simultaneously', () => {
      TestBed.configureTestingModule({});
      const fixture = TestBed.createComponent(AccordionParentHost);
      fixture.componentInstance.mode = 'multi';
      fixture.detectChanges();
      const triggers = fixture.nativeElement.querySelectorAll(
        '.trigger',
      ) as NodeListOf<HTMLButtonElement>;
      triggers[0].click();
      triggers[1].click();
      fixture.detectChanges();
      expect(triggers[0].getAttribute('aria-expanded')).toBe('true');
      expect(triggers[1].getAttribute('aria-expanded')).toBe('true');
    });
  });
});
