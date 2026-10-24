import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { PERMISSION_MODULES, PERMISSION_STRINGS } from '@permissions';
import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RolesService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import * as createDialog from './role-create-dialog.component';
import { RolesPage } from './roles.page';

expect.extend(toHaveNoViolations);

const roleFixtures = [
  {
    id: 'r1',
    name: 'Admin',
    description: 'Everything',
    permissions: ['orders:view', 'orders:manage', 'products:view'],
  },
  {
    id: 'r2',
    name: 'Support',
    description: 'Read-only',
    permissions: ['orders:view'],
  },
];

describe('RolesPage', () => {
  let fixture: ComponentFixture<RolesPage>;
  let page: RolesPage;
  let listSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let createSpy: jest.Mock;
  let dialogOpenSpy: jest.Mock;
  let openCreateSpy: jest.SpyInstance;

  function configure(perms: string[] = ['admin_users:view', 'admin_users:manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: RolesService,
          useValue: { list: listSpy, updatePermissions: updateSpy, create: createSpy },
        },
        { provide: Dialog, useValue: { open: dialogOpenSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(RolesPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() => of(roleFixtures));
    updateSpy = jest.fn((id: string, body: { permissions: string[] }) =>
      of({ ...roleFixtures.find((r) => r.id === id)!, permissions: body.permissions }),
    );
    createSpy = jest.fn();
    dialogOpenSpy = jest.fn();
    openCreateSpy = jest.spyOn(createDialog, 'openRoleCreateDialog').mockResolvedValue(null);
  });

  afterEach(() => openCreateSpy.mockRestore());

  it('loads + seeds the staged + initial permission sets', () => {
    configure();
    expect(page.isSelected('r1', 'orders', 'view')).toBe(true);
    expect(page.isSelected('r2', 'orders', 'manage')).toBe(false);
    expect(page.isDirty('r1')).toBe(false);
  });

  it('toggle flips staged selection + marks role dirty', () => {
    configure();
    page.toggle('r2', 'orders', 'manage', { target: { checked: true } } as unknown as Event);
    expect(page.isSelected('r2', 'orders', 'manage')).toBe(true);
    expect(page.isDirty('r2')).toBe(true);
  });

  it('revert rolls the staged set back to initial', () => {
    configure();
    page.toggle('r2', 'orders', 'manage', { target: { checked: true } } as unknown as Event);
    page.revert(roleFixtures[1] as never);
    expect(page.isDirty('r2')).toBe(false);
  });

  it('save PATCHes the full staged set', () => {
    configure();
    page.toggle('r2', 'orders', 'manage', { target: { checked: true } } as unknown as Event);
    page.save(roleFixtures[1] as never);
    expect(updateSpy).toHaveBeenCalledWith('r2', {
      permissions: expect.arrayContaining(['orders:view', 'orders:manage']),
    });
  });

  it('save refuses an empty permission set', () => {
    configure();
    page.toggle('r2', 'orders', 'view', { target: { checked: false } } as unknown as Event);
    page.save(roleFixtures[1] as never);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(page.error()).toContain('at least one');
  });

  it('canManage is false without admin_users:manage', () => {
    configure(['admin_users:view']);
    expect(page.canManage()).toBe(false);
  });

  it('ApiForbiddenError surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('ApiNotFoundError surfaces the role-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Role not found.');
  });

  it('New role button is hidden when the user only has admin_users:view', () => {
    configure(['admin_users:view']);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="roles-new"]'),
    ).toBeNull();
  });

  it('openCreateDialog splices the new role into the list on success', async () => {
    openCreateSpy.mockResolvedValueOnce({
      id: 'r-new',
      name: 'QA',
      description: 'Quality',
      permissions: ['orders:view'],
    } as never);
    configure();
    await page.openCreateDialog();
    expect(page.roles().some((r) => r.id === 'r-new')).toBe(true);
    expect(page.isSelected('r-new', 'orders', 'view')).toBe(true);
  });

  it('openCreateDialog is a no-op when the dialog is cancelled', async () => {
    configure();
    const before = page.roles().length;
    await page.openCreateDialog();
    expect(page.roles().length).toBe(before);
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  describe('catalogue is the shared constant, not the union of role rows', () => {
    const legacyRole = {
      id: 'r-legacy',
      name: 'Legacy',
      description: 'Carries pre-reconcile keys',
      permissions: ['orders:view', 'gift-cards:view', 'rbac:manage', 'tax:view'],
    };

    beforeEach(() => {
      listSpy = jest.fn(() => of([legacyRole]));
    });

    it('renders exactly the catalogue modules, whatever the role carries', () => {
      configure();
      expect(page.grouped).toHaveLength(PERMISSION_MODULES.length);
      expect(page.catalogue).toHaveLength(PERMISSION_STRINGS.length);
    });

    it('paints no fieldset for an out-of-catalogue module', () => {
      configure();
      const modules = page.grouped.map((g) => g.module);
      expect(modules).not.toContain('gift-cards');
      expect(modules).not.toContain('rbac');
      expect(modules).not.toContain('tax');
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).not.toContain('role-r-legacy-perm-gift-cards-view');
      expect(html).not.toContain('role-r-legacy-perm-rbac-manage');
    });

    it('drops out-of-catalogue keys from the staged set, so a save self-heals the role', () => {
      configure();
      expect(page.isSelected('r-legacy', 'orders', 'view')).toBe(true);
      expect(page.isSelected('r-legacy', 'gift-cards', 'view')).toBe(false);

      page.save(legacyRole as never);
      expect(updateSpy).toHaveBeenCalledWith('r-legacy', { permissions: ['orders:view'] });
    });

    it('is not dirty on load even though the persisted set was filtered', () => {
      configure();
      expect(page.isDirty('r-legacy')).toBe(false);
    });
  });

  it('renders the curated module label in the legend, never the raw key', () => {
    configure();
    const legend = (fixture.nativeElement as HTMLElement).querySelector(
      '#role-r1-module-admin_users',
    );
    expect(legend?.textContent?.trim()).toBe('Staff & Roles');
  });

  it('renders the scope hint that tells the operator where currencies and tax live', () => {
    configure();
    const settingsGroup = (fixture.nativeElement as HTMLElement)
      .querySelector('#role-r1-module-settings')
      ?.closest('fieldset');
    expect(settingsGroup?.textContent).toContain('Currencies, tax, countries, webhooks');
  });

  it('scopes each checkbox accessible name to its role, so two cards are distinguishable', () => {
    configure();
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="role-r1-perm-admin_users-view"]',
    );
    expect(checkbox?.getAttribute('aria-label')).toBe('Admin / Staff & Roles: view');
  });

  it('gives the count chip a spoken label', () => {
    configure();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('[aria-label$="selected"]');
    // Derived, not pinned. This asserted a hard-coded 125 until E1 registered
    // the `license` module and the catalogue became 130, which left the admin
    // unit suite red from that commit onwards for a number nobody had to
    // change on purpose. The page reads the same constant.
    expect(chip?.getAttribute('aria-label')).toBe(
      `3 of ${PERMISSION_STRINGS.length} permissions selected`,
    );
  });
});
