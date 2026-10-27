import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OrdersService, type Order } from '@admin-services';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { OrderActionsComponent } from './order-actions.component';

expect.extend(toHaveNoViolations);

@Component({
  standalone: true,
  imports: [OrderActionsComponent],
  template: `
    <app-order-actions
      [order]="order()"
      [canManage]="canManage()"
      (orderChanged)="lastChange = $event"
    />
  `,
})
class Host {
  readonly order: WritableSignal<Order>;
  readonly canManage = signal(true);
  lastChange: Order | null = null;

  constructor() {
    this.order = signal<Order>({
      id: 'order-1',
      orderNumber: 'ORD-2026-000001',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      total: 100,
      currency: 'USD',
      createdAt: '2026-04-16T10:00:00.000Z',
      updatedAt: '2026-04-16T10:00:00.000Z',
    });
  }
}

describe('OrderActionsComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let updateStatusSpy: jest.Mock;
  let addNoteSpy: jest.Mock;
  let confirmSpy: jest.SpyInstance;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: OrdersService,
          useValue: { updateStatus: updateStatusSpy, addNote: addNoteSpy },
        },
      ],
    });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    updateStatusSpy = jest.fn(() => of({ ...host.order(), status: 'CONFIRMED' } as Order));
    addNoteSpy = jest.fn(() => of({ id: 'note-1' }));
    confirmSpy = jest.spyOn(adminUi, 'openConfirmDialog').mockResolvedValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('hides the section entirely when the user cannot manage', async () => {
    configure();
    host.canManage.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=order-actions]')).toBeNull();
  });

  it('status submit stays disabled until a different status is picked', async () => {
    configure();
    await Promise.resolve();
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid=order-status-submit] button',
    );
    expect(button.disabled).toBe(true);

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      '[data-testid=order-status-select]',
    );
    select.value = 'CONFIRMED';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('offers status options as labels while posting the raw enum', async () => {
    configure();
    await Promise.resolve();
    fixture.detectChanges();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      '[data-testid=order-status-select]',
    );
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Pending', 'Confirmed']);
    expect([...select.options].map((o) => o.value)).toEqual(['PENDING', 'CONFIRMED']);
  });

  // ── QA C3: only offer what the backend state machine accepts ────────────────

  function statusValues(): string[] {
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      '[data-testid=order-status-select]',
    );
    return select ? [...select.options].map((o) => o.value) : [];
  }
  function cancelButton(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid=order-cancel]');
  }
  async function withStatus(status: Order['status']): Promise<void> {
    configure();
    await Promise.resolve();
    host.order.set({ ...host.order(), status });
    fixture.detectChanges();
  }

  it('offers cancel and the one legal next status on a PENDING order', async () => {
    await withStatus('PENDING');
    expect(cancelButton()).not.toBeNull();
    expect(statusValues()).toEqual(['PENDING', 'CONFIRMED']);
  });

  it('hides cancel on a DELIVERED order and explains why', async () => {
    await withStatus('DELIVERED');
    // The full-width red button used to render enabled here and end in a 400
    // the operator could not have predicted.
    expect(cancelButton()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('can no longer be cancelled');
    expect(statusValues()).toEqual(['DELIVERED', 'COMPLETED']);
  });

  it('drops the select entirely in a terminal state', async () => {
    await withStatus('COMPLETED');
    expect(cancelButton()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=order-status-select]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid=order-status-submit]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Terminal state');
  });

  it('offers ON_HOLD from PROCESSING, which the old hardcoded list omitted', async () => {
    await withStatus('PROCESSING');
    expect(statusValues()).toEqual(['PROCESSING', 'ON_HOLD', 'SHIPPED']);
    expect(cancelButton()).not.toBeNull();
  });

  it('confirms + calls updateStatus on Apply', async () => {
    configure();
    await Promise.resolve();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    component.pendingStatus.set('CONFIRMED');
    await component.confirmStatusChange();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateStatusSpy).toHaveBeenCalledWith('order-1', { status: 'CONFIRMED' });
    expect(host.lastChange?.status).toBe('CONFIRMED');
  });

  it('skips the API call when the user cancels the confirm dialog', async () => {
    configure();
    await Promise.resolve();
    confirmSpy.mockResolvedValueOnce(false);
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    component.pendingStatus.set('CONFIRMED');
    await component.confirmStatusChange();
    expect(updateStatusSpy).not.toHaveBeenCalled();
  });

  it('maps ApiConflictError to a concurrency-aware error message', async () => {
    updateStatusSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'terminal' })),
    );
    configure();
    await Promise.resolve();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    component.pendingStatus.set('CONFIRMED');
    await component.confirmStatusChange();
    expect(component.error()).toContain('terminal state');
  });

  it('maps ApiForbiddenError to a permission-specific error message', async () => {
    updateStatusSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    await Promise.resolve();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    component.pendingStatus.set('CONFIRMED');
    await component.confirmStatusChange();
    expect(component.error()).toContain('permission');
  });

  it('maps ApiNotFoundError to the Order-not-found error message', async () => {
    updateStatusSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    await Promise.resolve();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    component.pendingStatus.set('CONFIRMED');
    await component.confirmStatusChange();
    expect(component.error()).toBe('Order not found.');
  });

  it('cancel action requires confirmation + sets CANCELLED', async () => {
    configure();
    await Promise.resolve();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    await component.confirmCancel();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(updateStatusSpy).toHaveBeenCalledWith('order-1', { status: 'CANCELLED' });
  });

  it('cancel action is blocked when the order is already cancelled', async () => {
    host?.order.set({ ...host!.order(), status: 'CANCELLED' });
    configure();
    await Promise.resolve();
    host.order.set({ ...host.order(), status: 'CANCELLED' });
    fixture.detectChanges();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    await component.confirmCancel();
    expect(updateStatusSpy).not.toHaveBeenCalled();
  });

  it('refuses a cancel call the backend would reject even if it is reached', async () => {
    await withStatus('DELIVERED');
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    await component.confirmCancel();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateStatusSpy).not.toHaveBeenCalled();
  });

  it('note form rejects empty submissions', async () => {
    configure();
    await Promise.resolve();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    component.addNote();
    expect(addNoteSpy).not.toHaveBeenCalled();
    expect(component.noteError()).toContain('Write something');
  });

  it('note form submits + clears on success', async () => {
    configure();
    await Promise.resolve();
    const component = fixture.debugElement.children[0].componentInstance as OrderActionsComponent;
    component.noteForm.setValue({ note: 'Called customer, FedEx delay.' });
    component.addNote();
    expect(addNoteSpy).toHaveBeenCalledWith('order-1', {
      note: 'Called customer, FedEx delay.',
    });
    expect(component.noteForm.controls.note.value).toBe('');
  });

  it('has no axe violations in the managed state', async () => {
    configure();
    await Promise.resolve();
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
