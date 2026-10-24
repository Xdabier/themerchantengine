import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { TabStripComponent, type TabStripItem } from './tab-strip.component';

expect.extend(toHaveNoViolations);

@Component({
  standalone: true,
  imports: [TabStripComponent],
  template: `
    <app-tab-strip
      [tabs]="tabs"
      [active]="active()"
      ariaLabel="Demo tabs"
      (tabChanged)="active.set($event)"
    />
    @for (tab of tabs; track tab.value) {
      <div
        role="tabpanel"
        [id]="'tab-panel-' + tab.value"
        [attr.aria-labelledby]="'tab-' + tab.value"
        [hidden]="active() !== tab.value"
      >
        Panel {{ tab.label }}
      </div>
    }
  `,
})
class Host {
  readonly tabs: TabStripItem[] = [
    { value: 'one', label: 'One' },
    { value: 'two', label: 'Two' },
    { value: 'three', label: 'Three' },
  ];
  readonly active = signal<string>('one');
}

describe('TabStripComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  function clickTab(value: string) {
    (
      fixture.nativeElement.querySelector(`[data-testid=tab-strip-${value}]`) as HTMLButtonElement
    ).click();
  }

  function keyOnTab(value: string, key: string) {
    const el = fixture.nativeElement.querySelector(
      `[data-testid=tab-strip-${value}]`,
    ) as HTMLElement;
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('marks exactly one tab aria-selected', () => {
    const tabs = fixture.nativeElement.querySelectorAll('[role=tab]');
    const selected = Array.from(tabs).filter(
      (t) => (t as HTMLElement).getAttribute('aria-selected') === 'true',
    );
    expect(selected).toHaveLength(1);
  });

  it('emits tabChanged when a different tab is clicked', () => {
    clickTab('two');
    expect(host.active()).toBe('two');
  });

  it('arrow keys cycle the active tab (wraps at ends)', () => {
    keyOnTab('one', 'ArrowLeft');
    expect(host.active()).toBe('three');
    keyOnTab('three', 'ArrowRight');
    expect(host.active()).toBe('one');
  });

  it('Home + End jump to ends', () => {
    keyOnTab('one', 'End');
    expect(host.active()).toBe('three');
    keyOnTab('three', 'Home');
    expect(host.active()).toBe('one');
  });

  it('has no axe violations', async () => {
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
