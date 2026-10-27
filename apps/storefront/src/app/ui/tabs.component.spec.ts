import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TabPanelDirective, TabsComponent, type Tab } from './tabs.component';
import { assertAxeClean, renderComponent } from './testing';

@Component({
  standalone: true,
  imports: [TabsComponent, TabPanelDirective],
  template: `
    <app-tabs [tabs]="tabs">
      <ng-template appTabPanel="overview"
        ><p data-testid="p-overview">Overview body</p></ng-template
      >
      <ng-template appTabPanel="specs"><p data-testid="p-specs">Specs body</p></ng-template>
      <ng-template appTabPanel="reviews"><p data-testid="p-reviews">Reviews body</p></ng-template>
    </app-tabs>
  `,
})
class TabsHost {
  tabs: Tab[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'specs', label: 'Specs' },
    { id: 'reviews', label: 'Reviews' },
  ];
}

const tabs: Tab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'specs', label: 'Specs' },
  { id: 'reviews', label: 'Reviews' },
];

describe('TabsComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders a tablist with role=tab on each button', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const tablist = fixture.nativeElement.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[role="tab"]').length).toBe(3);
  });

  it('marks first tab selected by default + renders matching tabpanel', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const selected = fixture.nativeElement.querySelector('[aria-selected="true"]');
    expect(selected?.textContent?.trim()).toBe('Overview');
    const panel = fixture.nativeElement.querySelector('[role="tabpanel"]');
    expect(panel).not.toBeNull();
  });

  it('emits selectedChange on click', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const handler = vi.fn();
    fixture.componentInstance.selectedChange.subscribe(handler);
    const buttons = fixture.nativeElement.querySelectorAll('[role="tab"]');
    (buttons[1] as HTMLButtonElement).click();
    expect(handler).toHaveBeenCalledWith('specs');
  });

  it('moves selection on ArrowRight', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const handler = vi.fn();
    fixture.componentInstance.selectedChange.subscribe(handler);
    const buttons = fixture.nativeElement.querySelectorAll('[role="tab"]');
    (buttons[0] as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(handler).toHaveBeenCalledWith('specs');
  });

  it('jumps to last on End key', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const handler = vi.fn();
    fixture.componentInstance.selectedChange.subscribe(handler);
    const buttons = fixture.nativeElement.querySelectorAll('[role="tab"]');
    (buttons[0] as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(handler).toHaveBeenCalledWith('reviews');
  });

  it('moves selection backward on ArrowLeft (LTR)', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const handler = vi.fn();
    fixture.componentInstance.selectedChange.subscribe(handler);
    // jump to last tab first
    const buttons = fixture.nativeElement.querySelectorAll('[role="tab"]');
    (buttons[0] as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    handler.mockClear();
    (buttons[2] as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(handler).toHaveBeenCalledWith('specs');
  });

  it('jumps to first on Home key', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const handler = vi.fn();
    fixture.componentInstance.selectedChange.subscribe(handler);
    const buttons = fixture.nativeElement.querySelectorAll('[role="tab"]');
    (buttons[2] as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(handler).toHaveBeenCalledWith('overview');
  });

  it('renders all tabpanels with [hidden] on inactive ones (preserves DOM IDs for aria-controls)', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    const panels = fixture.nativeElement.querySelectorAll(
      '[role="tabpanel"]',
    ) as NodeListOf<HTMLElement>;
    expect(panels.length).toBe(3);
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);
    expect(panels[2].hidden).toBe(true);
  });

  it('projects only the active tab panel via appTabPanel directive (lazy mount)', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(TabsHost);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=p-overview]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=p-specs]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=p-reviews]')).toBeNull();
    const tabs = fixture.nativeElement.querySelectorAll('[role="tab"]');
    (tabs[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=p-overview]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=p-specs]')).not.toBeNull();
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(TabsComponent, { tabs });
    await assertAxeClean(fixture.nativeElement);
  });
});
