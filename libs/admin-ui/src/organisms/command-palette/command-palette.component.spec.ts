import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommandPaletteComponent, openCommandPalette } from './command-palette.component';
import type { NavItem } from '../sidebar/sidebar.component';

@Component({
  standalone: true,
  imports: [DialogModule],
  template: '',
})
class HostComponent {
  private readonly dialog = inject(Dialog);
  readonly result = signal<NavItem | null>(null);
  readonly items: NavItem[] = [
    { label: 'Orders', to: '/orders' },
    { label: 'Products', to: '/products' },
    { label: 'Customers', to: '/customers' },
  ];

  async open(): Promise<void> {
    const r = await openCommandPalette(this.dialog, { items: this.items });
    this.result.set(r?.item ?? null);
  }
}

describe('CommandPalette', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, CommandPaletteComponent, DialogModule],
    }).compileComponents();
  });

  it('renders every item initially and filters on query', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open();
    await fixture.whenStable();
    fixture.detectChanges();

    const list = document.querySelector('[data-testid="palette-list"]') as HTMLElement;
    expect(list.querySelectorAll('li').length).toBe(3);

    const input = document.querySelector('[data-testid="palette-input"]') as HTMLInputElement;
    input.value = 'ord';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const filteredList = document.querySelector('[data-testid="palette-list"]') as HTMLElement;
    const remaining = filteredList.querySelectorAll('li');
    expect(remaining.length).toBe(1);
    expect(remaining[0].textContent).toContain('Orders');
  });

  it('clicking an item resolves with that NavItem', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.open();
    await fixture.whenStable();
    fixture.detectChanges();

    const firstItem = document.querySelector('[data-testid="palette-list"] li') as HTMLElement;
    firstItem.click();
    await promise;
    expect(fixture.componentInstance.result()?.to).toBe('/orders');
  });
});
