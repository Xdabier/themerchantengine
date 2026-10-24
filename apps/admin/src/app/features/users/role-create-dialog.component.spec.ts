import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RolesService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { PERMISSION_STRINGS } from '@permissions';
import { RoleCreateDialogComponent } from './role-create-dialog.component';
import { groupPermissionsByModule } from './users.utils';

expect.extend(toHaveNoViolations);

const catalogue = [
  { module: 'admin_users', label: 'Staff & Roles', actions: ['view', 'manage'] },
  { module: 'orders', label: 'Orders', actions: ['view'] },
];

describe('RoleCreateDialogComponent', () => {
  let fixture: ComponentFixture<RoleCreateDialogComponent>;
  let dialog: RoleCreateDialogComponent;
  let createSpy: jest.Mock;
  let closeSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        { provide: RolesService, useValue: { create: createSpy } },
        { provide: DialogRef, useValue: { close: closeSpy } },
        { provide: DIALOG_DATA, useValue: { catalogue } },
      ],
    });
    fixture = TestBed.createComponent(RoleCreateDialogComponent);
    dialog = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    createSpy = jest.fn(() =>
      of({ id: 'r-new', name: 'QA', description: 'x', permissions: ['orders:view'] }),
    );
    closeSpy = jest.fn();
  });

  it('renders the name + description inputs', () => {
    configure();
    expect(fixture.nativeElement.querySelector('[data-testid="role-create-name"]')).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="role-create-description"]'),
    ).toBeTruthy();
  });

  it('renders a checkbox per catalogue action', () => {
    configure();
    expect(fixture.nativeElement.querySelectorAll('input[type="checkbox"]').length).toBe(3);
  });

  it('labels each module group with its human label, not the raw key', () => {
    configure();
    const legends = [...fixture.nativeElement.querySelectorAll('fieldset legend')].map(
      (el: Element) => el.textContent?.trim(),
    );
    expect(legends).toContain('Staff & Roles');
    expect(legends).not.toContain('admin_users');
  });

  it('submit with zero permissions surfaces the inline error and does not call create', () => {
    configure();
    dialog.form.controls.name.setValue('QA');
    dialog.submit();
    expect(createSpy).not.toHaveBeenCalled();
    expect(dialog.errorMessage()).toContain('at least one');
  });

  it('valid submit calls create() with the selected permissions', () => {
    configure();
    dialog.form.controls.name.setValue('QA');
    dialog.toggle('orders', 'view', {
      target: { checked: true },
    } as unknown as Event);
    dialog.submit();
    expect(createSpy).toHaveBeenCalledWith({
      name: 'QA',
      description: undefined,
      permissions: ['orders:view'],
    });
  });

  it('closes with the fresh role on success', () => {
    configure();
    dialog.form.controls.name.setValue('QA');
    dialog.toggle('orders', 'view', {
      target: { checked: true },
    } as unknown as Event);
    dialog.submit();
    expect(closeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'r-new' }));
  });

  it('ApiConflictError surfaces the branded error banner', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'dup' })),
    );
    configure();
    dialog.form.controls.name.setValue('QA');
    dialog.toggle('orders', 'view', {
      target: { checked: true },
    } as unknown as Event);
    dialog.submit();
    expect(dialog.errorMessage()).toContain('already exists');
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('ApiForbiddenError surfaces the branded error banner', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    dialog.form.controls.name.setValue('QA');
    dialog.toggle('orders', 'view', {
      target: { checked: true },
    } as unknown as Event);
    dialog.submit();
    expect(dialog.errorMessage()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the role-not-found error', () => {
    createSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    dialog.form.controls.name.setValue('QA');
    dialog.toggle('orders', 'view', {
      target: { checked: true },
    } as unknown as Event);
    dialog.submit();
    expect(dialog.errorMessage()).toBe('Role not found.');
  });

  it('cancel closes with null', () => {
    configure();
    dialog.cancel();
    expect(closeSpy).toHaveBeenCalledWith(null);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  describe('at the real catalogue scale the host page passes', () => {
    // The 2-module fixture above is a fraction of what /roles actually hands the
    // dialog. Run the a11y and structural checks against all 125 checkboxes.
    function configureFull() {
      TestBed.configureTestingModule({
        providers: [
          { provide: RolesService, useValue: { create: createSpy } },
          { provide: DialogRef, useValue: { close: closeSpy } },
          {
            provide: DIALOG_DATA,
            useValue: { catalogue: groupPermissionsByModule([...PERMISSION_STRINGS]) },
          },
        ],
      });
      fixture = TestBed.createComponent(RoleCreateDialogComponent);
      fixture.detectChanges();
    }

    it('renders one checkbox per catalogue permission', () => {
      configureFull();
      expect(fixture.nativeElement.querySelectorAll('input[type="checkbox"]').length).toBe(
        PERMISSION_STRINGS.length,
      );
    });

    it('renders the settings scope hint', () => {
      configureFull();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Currencies, tax, countries, webhooks',
      );
    });

    it('has no axe violations', async () => {
      configureFull();
      const results = await axe(fixture.nativeElement);
      expect(results).toHaveNoViolations();
    });
  });
});
