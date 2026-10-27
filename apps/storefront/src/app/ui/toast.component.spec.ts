import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { ToastContainerComponent, ToastService } from './toast.component';
import { assertAxeClean, renderComponent } from './testing';

describe('ToastService + ToastContainerComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('renders pushed toasts inside the container with correct role', async () => {
    const fixture = await renderComponent(ToastContainerComponent);
    const svc = TestBed.inject(ToastService);
    svc.success('Saved');
    fixture.detectChanges();
    const toast = fixture.nativeElement.querySelector('.toast');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.classList.contains('v-success')).toBe(true);
  });

  it('error variant uses role=alert and is sticky (no auto-dismiss)', async () => {
    const fixture = await renderComponent(ToastContainerComponent);
    const svc = TestBed.inject(ToastService);
    svc.error('Boom');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.toast')?.getAttribute('role')).toBe('alert');
    vi.advanceTimersByTime(20_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.toast').length).toBe(1);
  });

  it('auto-dismisses success after default duration', async () => {
    const fixture = await renderComponent(ToastContainerComponent);
    const svc = TestBed.inject(ToastService);
    svc.success('Saved');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.toast').length).toBe(1);
    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.toast').length).toBe(0);
  });

  it('caps the stack at 3 visible toasts', async () => {
    const fixture = await renderComponent(ToastContainerComponent);
    const svc = TestBed.inject(ToastService);
    svc.success('A');
    svc.success('B');
    svc.success('C');
    svc.success('D');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.toast').length).toBe(3);
    expect(fixture.nativeElement.textContent).not.toContain('A');
    expect(fixture.nativeElement.textContent).toContain('D');
  });

  it('dismisses on close button click', async () => {
    const fixture = await renderComponent(ToastContainerComponent);
    const svc = TestBed.inject(ToastService);
    svc.success('Saved');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.toast').length).toBe(0);
  });

  it('warning variant uses role=alert + v-warning class', async () => {
    const fixture = await renderComponent(ToastContainerComponent);
    const svc = TestBed.inject(ToastService);
    svc.warning('Heads up');
    fixture.detectChanges();
    const toast = fixture.nativeElement.querySelector('.toast');
    expect(toast?.getAttribute('role')).toBe('alert');
    expect(toast?.classList.contains('v-warning')).toBe(true);
  });

  it('passes axe with a visible toast', async () => {
    vi.useRealTimers();
    const fixture = await renderComponent(ToastContainerComponent);
    const svc = TestBed.inject(ToastService);
    svc.success('Saved');
    fixture.detectChanges();
    await assertAxeClean(fixture.nativeElement);
  });
});
