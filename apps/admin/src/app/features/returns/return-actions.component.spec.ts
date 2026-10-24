import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReturnsService, type ReturnDetail } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ReturnActionsComponent } from './return-actions.component';

expect.extend(toHaveNoViolations);

describe('ReturnActionsComponent', () => {
  let fixture: ComponentFixture<ReturnActionsComponent>;
  let component: ReturnActionsComponent;
  let svc: {
    approve: jest.Mock;
    reject: jest.Mock;
    receive: jest.Mock;
    refund: jest.Mock;
    close: jest.Mock;
  };
  let dialog: { open: jest.Mock };

  const baseReturn: ReturnDetail = {
    id: 'return-1',
    returnNumber: 'RET-2026-0001',
    orderId: 'order-4',
    status: 'REQUESTED',
    reason: 'WRONG_SIZE',
    createdAt: '2026-04-15T12:00:00.000Z',
    items: [
      {
        id: 'ri-1',
        orderItemId: 'oi-1',
        quantity: 1,
        restockDecision: 'RESTOCK',
        orderItem: { sku: 'SHOE-42', productName: 'Urban Runner Sneakers', unitPrice: '349' },
      },
    ],
  };

  function makeWith(
    record: ReturnDetail = baseReturn,
    canManage = true,
  ): ComponentFixture<ReturnActionsComponent> {
    svc = {
      approve: jest.fn(() => of({ ...record, status: 'APPROVED' })),
      reject: jest.fn(() => of({ ...record, status: 'REJECTED' })),
      receive: jest.fn(() => of({ ...record, status: 'ITEM_RECEIVED' })),
      refund: jest.fn(() => of({ ...record, status: 'REFUND_PROCESSED' })),
      close: jest.fn(() => of({ ...record, status: 'CLOSED' })),
    };
    dialog = { open: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: ReturnsService, useValue: svc },
        { provide: Dialog, useValue: dialog },
      ],
    });
    const f = TestBed.createComponent(ReturnActionsComponent);
    f.componentRef.setInput('return', record);
    f.componentRef.setInput('canManage', canManage);
    f.detectChanges();
    return f;
  }

  it('renders nothing when canManage is false', () => {
    fixture = makeWith(baseReturn, false);
    component = fixture.componentInstance;
    expect(fixture.nativeElement.querySelector('[data-testid="return-actions"]')).toBeNull();
  });

  it('enables approve + reject for a REQUESTED return', () => {
    fixture = makeWith(baseReturn);
    component = fixture.componentInstance;
    expect(component.allowed('approve')).toBe(true);
    expect(component.allowed('reject')).toBe(true);
    expect(component.allowed('receive')).toBe(false);
    expect(component.allowed('refund')).toBe(false);
  });

  it('only allows close on a REFUND_PROCESSED return', () => {
    fixture = makeWith({ ...baseReturn, status: 'REFUND_PROCESSED' });
    component = fixture.componentInstance;
    expect(component.allowed('close')).toBe(true);
    expect(component.allowed('approve')).toBe(false);
    expect(component.allowed('reject')).toBe(false);
    expect(component.allowed('receive')).toBe(false);
    expect(component.allowed('refund')).toBe(false);
  });

  it('blocks every action on a CLOSED return', () => {
    fixture = makeWith({ ...baseReturn, status: 'CLOSED' });
    component = fixture.componentInstance;
    for (const a of ['approve', 'reject', 'receive', 'refund', 'close'] as const) {
      expect(component.allowed(a)).toBe(false);
    }
  });

  it('confirmApprove() calls service.approve() after the user confirms', async () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    // openConfirmDialog uses dialog.open().closed subscription — stub to emit true.
    dialog.open.mockReturnValue({
      closed: {
        subscribe: (fn: (v: boolean) => void) => {
          fn(true);
          return { unsubscribe: () => undefined };
        },
      },
    });
    await component.confirmApprove();
    expect(svc.approve).toHaveBeenCalledWith('return-1');
    expect(component.lastAction()).toBe('Return approved');
  });

  it('confirmClose() closes the return and emits returnChanged with the updated record', async () => {
    fixture = makeWith({ ...baseReturn, status: 'REFUND_PROCESSED' });
    component = fixture.componentInstance;
    const emitted = jest.fn();
    component.returnChanged.subscribe(emitted);
    dialog.open.mockReturnValue({
      closed: {
        subscribe: (fn: (v: boolean) => void) => {
          fn(true);
          return { unsubscribe: () => undefined };
        },
      },
    });
    await component.confirmClose();
    expect(svc.close).toHaveBeenCalledWith('return-1');
    expect(component.lastAction()).toBe('Return closed');
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ status: 'CLOSED' }));
  });

  it('confirmClose() no-ops when the return is not in a closable state', async () => {
    fixture = makeWith({ ...baseReturn, status: 'REQUESTED' });
    component = fixture.componentInstance;
    await component.confirmClose();
    expect(svc.close).not.toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('confirmApprove() skips the service call when the dialog returns false', async () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    dialog.open.mockReturnValue({
      closed: {
        subscribe: (fn: (v: boolean) => void) => {
          fn(false);
          return { unsubscribe: () => undefined };
        },
      },
    });
    await component.confirmApprove();
    expect(svc.approve).not.toHaveBeenCalled();
  });

  it('submitReject() requires a reason before hitting the service', () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    component.openPanel('reject');
    component.submitReject();
    expect(svc.reject).not.toHaveBeenCalled();

    component.rejectForm.controls.reason.setValue('Outside window.');
    component.submitReject();
    expect(svc.reject).toHaveBeenCalledWith('return-1', { reason: 'Outside window.' });
  });

  it('submitReceive() builds the items payload from the form array', () => {
    fixture = makeWith({ ...baseReturn, status: 'APPROVED' });
    component = fixture.componentInstance;
    component.openPanel('receive');
    component.receiveForm.controls.items.at(0).controls.restockDecision.setValue('DAMAGED');
    component.receiveForm.controls.items.at(0).controls.notes.setValue('Scuffed sole.');
    component.submitReceive();
    expect(svc.receive).toHaveBeenCalledWith('return-1', {
      items: [{ returnItemId: 'ri-1', restockDecision: 'DAMAGED', notes: 'Scuffed sole.' }],
    });
  });

  it('submitRefund() forwards the chosen method', () => {
    fixture = makeWith({ ...baseReturn, status: 'ITEM_RECEIVED' });
    component = fixture.componentInstance;
    component.openPanel('refund');
    component.refundForm.controls.refundMethod.setValue('STORE_CREDIT');
    component.submitRefund();
    expect(svc.refund).toHaveBeenCalledWith('return-1', { refundMethod: 'STORE_CREDIT' });
  });

  it('maps ApiConflictError to a friendly state-conflict message', async () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    svc.approve.mockReturnValue(
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'stale' })),
    );
    dialog.open.mockReturnValue({
      closed: {
        subscribe: (fn: (v: boolean) => void) => {
          fn(true);
          return { unsubscribe: () => undefined };
        },
      },
    });
    await component.confirmApprove();
    expect(component.error()).toContain('no longer');
  });

  it('maps ApiForbiddenError to the permission-specific error', async () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    svc.approve.mockReturnValue(
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    dialog.open.mockReturnValue({
      closed: {
        subscribe: (fn: (v: boolean) => void) => {
          fn(true);
          return { unsubscribe: () => undefined };
        },
      },
    });
    await component.confirmApprove();
    expect(component.error()).toContain('permission');
  });

  it('maps ApiNotFoundError to the return-not-found error', async () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    svc.approve.mockReturnValue(
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    dialog.open.mockReturnValue({
      closed: {
        subscribe: (fn: (v: boolean) => void) => {
          fn(true);
          return { unsubscribe: () => undefined };
        },
      },
    });
    await component.confirmApprove();
    expect(component.error()).toBe('Return not found.');
  });

  it('has no axe violations in the default actions bar', async () => {
    fixture = makeWith();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when the reject panel is open', async () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    component.openPanel('reject');
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when the receive panel is open', async () => {
    fixture = makeWith({ ...baseReturn, status: 'APPROVED' });
    component = fixture.componentInstance;
    component.openPanel('receive');
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations when the refund panel is open', async () => {
    fixture = makeWith({ ...baseReturn, status: 'ITEM_RECEIVED' });
    component = fixture.componentInstance;
    component.openPanel('refund');
    fixture.detectChanges();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('emits returnChanged on a successful action', async () => {
    fixture = makeWith();
    component = fixture.componentInstance;
    const emitted = jest.fn();
    component.returnChanged.subscribe(emitted);
    dialog.open.mockReturnValue({
      closed: {
        subscribe: (fn: (v: boolean) => void) => {
          fn(true);
          return { unsubscribe: () => undefined };
        },
      },
    });
    await component.confirmApprove();
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ status: 'APPROVED' }));
  });
});
