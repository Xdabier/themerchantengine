import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent, openConfirmDialog } from './dialog.component';

@Component({
  standalone: true,
  imports: [DialogModule],
  template: '',
})
class HostComponent {
  private readonly dialog = inject(Dialog);
  readonly lastResult = signal<boolean | null>(null);

  async askConfirm(): Promise<void> {
    const result = await openConfirmDialog(this.dialog, {
      title: 'Delete product?',
      body: 'This cannot be undone.',
      tone: 'destructive',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    this.lastResult.set(result);
  }
}

describe('ConfirmDialog', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, ConfirmDialogComponent, DialogModule],
    }).compileComponents();
  });

  it('renders title + body + action buttons with brand tone', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.askConfirm();
    await fixture.whenStable();
    fixture.detectChanges();

    const dialogEl = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl).toBeTruthy();
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(dialogEl.textContent).toContain('Delete product?');
    expect(dialogEl.textContent).toContain('This cannot be undone.');

    const buttons = Array.from(dialogEl.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(
      expect.arrayContaining(['Keep', 'Delete']),
    );

    // Click confirm — should resolve with true.
    const confirm = buttons.find((b) => b.textContent?.includes('Delete'))!;
    confirm.click();
    await promise;
    expect(fixture.componentInstance.lastResult()).toBe(true);
  });

  it('resolves false when the cancel button is clicked', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.askConfirm();
    await fixture.whenStable();
    fixture.detectChanges();

    const dialogEl = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const cancel = Array.from(dialogEl.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Keep'),
    ) as HTMLButtonElement;
    cancel.click();
    await promise;
    expect(fixture.componentInstance.lastResult()).toBe(false);
  });
});
