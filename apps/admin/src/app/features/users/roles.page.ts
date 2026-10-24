import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ButtonComponent, SkeletonComponent } from '@admin-ui';
import { RolesService, type Role } from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { PERMISSION_STRINGS, type Permission } from '@permissions';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { openRoleCreateDialog } from './role-create-dialog.component';
import { collectRolePermissions, groupPermissionsByModule } from './users.utils';

/**
 * `/roles` — inline role editor.
 *
 * The grid columns are the shared `@permissions` catalogue, the same constant
 * the api decorators and the request DTOs use, so a checkbox can only exist for
 * a permission some endpoint actually enforces. It used to be the union of
 * every role's persisted set, which faithfully repainted ten dead module keys.
 *
 * A role that still carries a legacy key renders correctly (the key is filtered
 * out on load) and heals itself on its next save, because the PATCH replaces
 * the whole set. Toggling a checkbox stages the change locally per row.
 */
@Component({
  selector: 'app-roles-page',
  standalone: true,
  imports: [ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="roles-page">
      <header class="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <p class="text-xs tracking-widest uppercase text-ink-muted">People</p>
          <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Roles</h1>
          <p class="mt-3 text-sm text-ink-muted max-w-xl">
            Each role's checkbox grid replaces its full permission set when saved. Staff inherit the
            sum of their assigned roles' permissions.
          </p>
        </div>
        @if (canManage()) {
          <app-button variant="primary" size="md" (clicked)="openCreateDialog()" testId="roles-new">
            New role
          </app-button>
        }
      </header>

      <div role="alert" data-testid="roles-error">
        <p class="border border-status-error text-ink p-3 text-xs" [class.sr-only]="!error()">
          {{ error() ?? '' }}
        </p>
      </div>

      <div role="status" aria-live="polite" data-testid="roles-notice">
        <p class="border border-status-success text-ink p-3 text-xs" [class.sr-only]="!notice()">
          {{ notice() ?? '' }}
        </p>
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2rem" width="30%" />
          <app-skeleton height="8rem" width="100%" />
        </div>
      } @else if (roles().length === 0) {
        <p class="text-sm text-ink-muted text-center py-16">No roles have been created yet.</p>
      } @else {
        <ul class="flex flex-col gap-6" role="list">
          @for (role of roles(); track role.id) {
            <li class="border border-line p-5" [attr.data-testid]="'role-card-' + role.id">
              <header class="flex items-start justify-between gap-4 mb-4">
                <div class="min-w-0">
                  <h2 class="text-xl font-bold tracking-tight text-ink">{{ role.name }}</h2>
                  @if (role.description) {
                    <p class="mt-1 text-xs text-ink-muted">{{ role.description }}</p>
                  }
                </div>
                <div class="flex items-center gap-2">
                  <p
                    class="text-xs font-mono text-ink-muted tabular-nums"
                    [attr.aria-label]="
                      selectionCount(role.id) + ' of ' + catalogue.length + ' permissions selected'
                    "
                  >
                    {{ selectionCount(role.id) }} / {{ catalogue.length }}
                  </p>
                  @if (canManage()) {
                    <app-button
                      variant="primary"
                      size="sm"
                      [disabled]="!isDirty(role.id) || busyId() === role.id"
                      [loading]="busyId() === role.id"
                      (clicked)="save(role)"
                      [testId]="'role-save-' + role.id"
                      [ariaLabel]="'Save ' + role.name"
                    >
                      Save
                    </app-button>
                    @if (isDirty(role.id)) {
                      <app-button
                        variant="ghost"
                        size="sm"
                        [disabled]="busyId() === role.id"
                        (clicked)="revert(role)"
                        [testId]="'role-revert-' + role.id"
                        [ariaLabel]="'Revert ' + role.name"
                      >
                        Revert
                      </app-button>
                    }
                  }
                </div>
              </header>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                @for (group of grouped; track group.module) {
                  <fieldset
                    class="border border-line p-3"
                    [attr.aria-labelledby]="'role-' + role.id + '-module-' + group.module"
                  >
                    <legend
                      [id]="'role-' + role.id + '-module-' + group.module"
                      class="text-xs tracking-widest uppercase text-ink-muted px-2"
                    >
                      {{ group.label }}
                    </legend>
                    @if (group.hint) {
                      <p class="text-xs text-ink-muted mt-1">{{ group.hint }}</p>
                    }
                    <ul role="list" class="flex flex-col gap-1 mt-2">
                      @for (action of group.actions; track action) {
                        <li>
                          <label class="flex items-center gap-3 text-sm min-h-[44px]">
                            <input
                              type="checkbox"
                              class="h-4 w-4 accent-ink"
                              [checked]="isSelected(role.id, group.module, action)"
                              [disabled]="!canManage()"
                              [attr.aria-label]="role.name + ' / ' + group.label + ': ' + action"
                              (change)="toggle(role.id, group.module, action, $event)"
                              [attr.data-testid]="
                                'role-' + role.id + '-perm-' + group.module + '-' + action
                              "
                            />
                            <span>{{ action }}</span>
                          </label>
                        </li>
                      }
                    </ul>
                  </fieldset>
                }
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class RolesPage implements OnInit, OnDestroy {
  private readonly rolesService = inject(RolesService);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(Dialog);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly roles = signal<readonly Role[]>([]);
  readonly busyId = signal<string | null>(null);
  /** Per-role staged permission sets — key is role.id. */
  private readonly staged = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  /** Initial permission sets captured at fetch time for dirty + revert. */
  private readonly initial = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());

  readonly canManage = computed(() => this.authStore.hasPermission('admin_users:manage'));

  /** Full flat catalogue: the shared constant, not what the database holds. */
  readonly catalogue: readonly string[] = [...PERMISSION_STRINGS].sort();

  readonly grouped = groupPermissionsByModule(this.catalogue);
  private readonly catalogueSet = new Set<string>(this.catalogue);

  ngOnInit(): void {
    this.fetch();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  isSelected(roleId: string, module: string, action: string): boolean {
    return this.staged().get(roleId)?.has(`${module}:${action}`) ?? false;
  }

  isDirty(roleId: string): boolean {
    const s = this.staged().get(roleId) ?? new Set<string>();
    const i = this.initial().get(roleId) ?? new Set<string>();
    if (s.size !== i.size) return true;
    for (const v of s) if (!i.has(v)) return true;
    return false;
  }

  selectionCount(roleId: string): number {
    return this.staged().get(roleId)?.size ?? 0;
  }

  toggle(roleId: string, module: string, action: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const key = `${module}:${action}`;
    const next = new Map(this.staged());
    const set = new Set(next.get(roleId) ?? []);
    if (checked) set.add(key);
    else set.delete(key);
    next.set(roleId, set);
    this.staged.set(next);
  }

  revert(role: Role): void {
    const next = new Map(this.staged());
    next.set(role.id, new Set(this.initial().get(role.id) ?? []));
    this.staged.set(next);
  }

  save(role: Role): void {
    const staged = this.staged().get(role.id);
    if (!staged || staged.size === 0) {
      this.error.set('A role must have at least one permission.');
      return;
    }
    this.busyId.set(role.id);
    this.error.set(null);
    this.rolesService
      // Sound cast: the staged set is seeded and toggled from the catalogue only.
      .updatePermissions(role.id, { permissions: [...staged] as [Permission, ...Permission[]] })
      .subscribe({
        next: (updated) => {
          // Recompute initial from the server response so the next dirty
          // check reflects what actually persisted.
          const reset = new Map(this.initial());
          reset.set(updated.id, this.knownPermissions(updated.permissions));
          this.initial.set(reset);
          this.busyId.set(null);
          this.flashNotice(`${updated.name} updated — ${staged.size} permissions assigned.`);
        },
        error: (err: unknown) => {
          this.busyId.set(null);
          this.error.set(this.formatError(err, 'Could not save role.'));
        },
      });
  }

  async openCreateDialog(): Promise<void> {
    const created = await openRoleCreateDialog(this.dialog, {
      catalogue: this.grouped,
    });
    if (!created) return;
    const nextRoles = [...this.roles(), created];
    this.roles.set(nextRoles);
    const perms = this.knownPermissions(created.permissions);
    const initial = new Map(this.initial());
    initial.set(created.id, perms);
    this.initial.set(initial);
    const staged = new Map(this.staged());
    staged.set(created.id, new Set(perms));
    this.staged.set(staged);
    this.flashNotice(`${created.name} created.`);
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.rolesService
      .list()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (roles) => {
          this.roles.set(roles);
          const initial = new Map<string, ReadonlySet<string>>();
          for (const r of roles) {
            initial.set(r.id, this.knownPermissions(r.permissions));
          }
          this.initial.set(initial);
          this.staged.set(new Map(initial));
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  /**
   * A role row from a database that has not run the catalogue reconcile can
   * still carry keys no endpoint checks. Filtering them here keeps the grid
   * honest, and the next save drops them for good (the PATCH replaces the
   * whole set).
   */
  private knownPermissions(
    permissions: ReadonlyArray<string | { permission: string }>,
  ): ReadonlySet<string> {
    const known = new Set<string>();
    for (const p of collectRolePermissions(permissions)) {
      if (this.catalogueSet.has(p)) known.add(p);
    }
    return known;
  }

  private flashNotice(message: string): void {
    this.notice.set(message);
    setTimeout(() => this.notice.set(null), 4000);
  }

  private formatError(err: unknown, fallback = 'Could not load roles.'): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage roles.';
    if (err instanceof ApiNotFoundError) return 'Role not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
