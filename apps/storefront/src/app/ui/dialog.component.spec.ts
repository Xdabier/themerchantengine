import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DialogModule } from '@angular/cdk/dialog';

import { DialogFrameComponent, DialogService } from './dialog.component';
import { assertAxeClean } from './testing';

@Component({
  standalone: true,
  imports: [DialogFrameComponent],
  template: `
    <app-dialog-frame [labelledBy]="'dialog-title'" [describedBy]="'dialog-body'">
      <h2 id="dialog-title">Confirm</h2>
      <p id="dialog-body">Remove from cart?</p>
      <button type="button">Confirm</button>
      <button type="button">Cancel</button>
    </app-dialog-frame>
  `,
})
class ConfirmDialog {}

@Component({
  standalone: true,
  template: `<button type="button" (click)="open()">Open</button>`,
})
class DialogOpener {
  private readonly svc = inject(DialogService);
  open() {
    return this.svc.open(ConfirmDialog);
  }
}

describe('DialogFrameComponent + DialogService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DialogModule],
      providers: [DialogService],
    });
  });
  afterEach(() => TestBed.resetTestingModule());

  it('renders the frame with aria-labelledby + aria-describedby', () => {
    const fixture = TestBed.createComponent(ConfirmDialog);
    fixture.detectChanges();
    const frame = fixture.nativeElement.querySelector('.frame');
    expect(frame?.getAttribute('aria-labelledby')).toBe('dialog-title');
    expect(frame?.getAttribute('aria-describedby')).toBe('dialog-body');
  });

  it('opens via DialogService and renders the body inside a CDK overlay container', () => {
    const opener = TestBed.createComponent(DialogOpener);
    opener.detectChanges();
    const ref = opener.componentInstance.open();
    const overlayPane = document.body.querySelector('.cdk-overlay-pane');
    expect(overlayPane).not.toBeNull();
    const container = document.body.querySelector('cdk-dialog-container');
    expect(container).not.toBeNull();
    expect(container?.textContent).toContain('Confirm');
    expect(ref.config.ariaModal).toBe(true);
    expect(ref.config.role).toBe('dialog');
    ref.close();
  });

  it('closes on close()', () => {
    const opener = TestBed.createComponent(DialogOpener);
    opener.detectChanges();
    const ref = opener.componentInstance.open();
    ref.close();
    const overlayHost = document.body.querySelector('.cdk-overlay-pane');
    expect(overlayHost).toBeNull();
  });

  it('frame passes axe', async () => {
    const fixture = TestBed.createComponent(ConfirmDialog);
    fixture.detectChanges();
    await assertAxeClean(fixture.nativeElement);
  });

  it('closeAll() closes every open dialog', () => {
    const opener = TestBed.createComponent(DialogOpener);
    opener.detectChanges();
    opener.componentInstance.open();
    opener.componentInstance.open();
    expect(document.body.querySelectorAll('cdk-dialog-container').length).toBe(2);
    TestBed.inject(DialogService).closeAll();
    expect(document.body.querySelectorAll('cdk-dialog-container').length).toBe(0);
  });
});
