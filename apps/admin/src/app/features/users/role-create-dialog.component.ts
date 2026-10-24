import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Inject,
  Optional,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, InputComponent } from '@admin-ui';
import { RolesService, type Role } from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { type Permission } from '@permissions';

export interface RoleCreateDialogData {
  /** Pre-computed from groupPermissionsByModule() on the host page. */
  catalogue: ReadonlyArray<{
    module: string;
    label: string;
    hint?: string | null;
    actions: string[];
  }>;
  titleId?: string;
}

export type RoleCreateDialogResult = Role | null;

let roleCreateDialogSeq = 0;

export const ROLE_CREATE_DIALOG_TITLE_PREFIX = 'role-create-dialog-title';

@Component({
  selector: 'app-role-create-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, FormFieldComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="w-full max-w-2xl bg-surface border border-line p-6 overflow-y-auto max-h-[90vh]"
      data-testid="role-create-dialog"
    >
      <h2 [id]="titleId" class="text-xl md:text-2xl font-bold tracking-tight text-ink">
        Create a role
      </h2>
      <p class="mt-2 text-sm text-ink-muted">
        Staff inherit the sum of their assigned roles' permissions.
      </p>

      <div role="alert" class="mt-4" data-testid="role-create-error">
        <p
          class="border border-status-error text-ink p-3 text-xs"
          [class.sr-only]="!errorMessage()"
        >
          {{ errorMessage() ?? '' }}
        </p>
      </div>

      <form [formGroup]="form" (ngSubmit)="submit()" class="mt-6 flex flex-col gap-5" novalidate>
        <app-form-field label="Name" [fieldId]="nameId" [required]="true" [error]="nameError()">
          <app-input
            [id]="nameId"
            type="text"
            formControlName="name"
            data-testid="role-create-name"
            [invalid]="!!nameError()"
          ></app-input>
        </app-form-field>

        <app-form-field
          label="Description"
          [fieldId]="descriptionId"
          [error]="descriptionError()"
          hint="Optional — 255 characters max."
        >
          <app-input
            [id]="descriptionId"
            type="text"
            formControlName="description"
            data-testid="role-create-description"
            [invalid]="!!descriptionError()"
          ></app-input>
        </app-form-field>

        <fieldset
          class="border p-4"
          [class.border-line]="!permissionsInvalid()"
          [class.border-status-error]="permissionsInvalid()"
          [attr.aria-invalid]="permissionsInvalid() ? 'true' : null"
        >
          <legend class="text-xs tracking-widest uppercase text-ink-muted px-2">Permissions</legend>
          <p class="text-xs text-ink-muted mt-1 mb-3">{{ selectedCount() }} selected</p>
          @if (data.catalogue.length === 0) {
            <p class="text-sm text-ink-muted">
              No permission catalogue available. Create a role with at least one permission via the
              API first.
            </p>
          } @else {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              @for (group of data.catalogue; track group.module) {
                <fieldset
                  class="border border-line p-3"
                  [attr.aria-labelledby]="titleId + '-module-' + group.module"
                >
                  <legend
                    [id]="titleId + '-module-' + group.module"
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
                            [checked]="isSelected(group.module, action)"
                            [attr.aria-label]="group.label + ': ' + action"
                            (change)="toggle(group.module, action, $event)"
                            [attr.data-testid]="'role-create-perm-' + group.module + '-' + action"
                          />
                          <span>{{ action }}</span>
                        </label>
                      </li>
                    }
                  </ul>
                </fieldset>
              }
            </div>
          }
        </fieldset>

        <div class="flex items-center justify-end gap-3 pt-2">
          <app-button
            variant="ghost"
            type="button"
            (clicked)="cancel()"
            data-testid="role-create-cancel"
          >
            Cancel
          </app-button>
          <app-button
            type="submit"
            variant="primary"
            [disabled]="busy()"
            [loading]="busy()"
            testId="role-create-submit"
          >
            Create role
          </app-button>
        </div>
      </form>
    </div>
  `,
})
export class RoleCreateDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly rolesService = inject(RolesService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly titleId: string;
  readonly nameId: string;
  readonly descriptionId: string;

  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly selected = signal<ReadonlySet<string>>(new Set<string>());
  readonly selectedCount = computed(() => this.selected().size);
  readonly permissionsInvalid = signal(false);

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(50)]),
    description: this.fb.nonNullable.control('', [Validators.maxLength(255)]),
  });

  constructor(
    private readonly ref: DialogRef<RoleCreateDialogResult>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: RoleCreateDialogData,
  ) {
    this.titleId = data?.titleId ?? `${ROLE_CREATE_DIALOG_TITLE_PREFIX}-${++roleCreateDialogSeq}`;
    this.nameId = `${this.titleId}-name`;
    this.descriptionId = `${this.titleId}-description`;
  }

  isSelected(module: string, action: string): boolean {
    return this.selected().has(`${module}:${action}`);
  }

  toggle(module: string, action: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const key = `${module}:${action}`;
    const next = new Set(this.selected());
    if (checked) next.add(key);
    else next.delete(key);
    this.selected.set(next);
  }

  nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Name is required.';
    if (c.hasError('maxlength')) return 'Name must be 50 characters or fewer.';
    return null;
  }

  descriptionError(): string | null {
    const c = this.form.controls.description;
    if (!c.touched || c.valid) return null;
    if (c.hasError('maxlength')) return 'Description must be 255 characters or fewer.';
    return null;
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) {
      this.focusFirstInvalid();
      return;
    }
    const perms = [...this.selected()];
    if (perms.length === 0) {
      this.errorMessage.set('A role must have at least one permission.');
      this.permissionsInvalid.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.permissionsInvalid.set(false);
    const raw = this.form.getRawValue();
    this.busy.set(true);
    this.errorMessage.set(null);
    this.rolesService
      .create({
        name: raw.name.trim(),
        description: raw.description.trim() ? raw.description.trim() : undefined,
        // Sound cast: every key comes from the catalogue the grid renders.
        permissions: perms as [Permission, ...Permission[]],
      })
      .subscribe({
        next: (role) => {
          this.busy.set(false);
          this.ref.close(role);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.errorMessage.set(this.formatError(err));
        },
      });
  }

  cancel(): void {
    this.ref.close(null);
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() => {
      const el = this.host.nativeElement.querySelector(
        '[aria-invalid="true"]',
      ) as HTMLElement | null;
      el?.focus();
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to create roles.';
    if (err instanceof ApiConflictError) return 'A role with this name already exists.';
    if (err instanceof ApiNotFoundError) return 'Role not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not create role.';
  }
}

export async function openRoleCreateDialog(
  dialog: Dialog,
  data: RoleCreateDialogData,
): Promise<RoleCreateDialogResult> {
  const titleId = data.titleId ?? `${ROLE_CREATE_DIALOG_TITLE_PREFIX}-${++roleCreateDialogSeq}`;
  const ref = dialog.open<RoleCreateDialogResult>(RoleCreateDialogComponent, {
    data: { ...data, titleId },
    ariaLabelledBy: titleId,
    ariaModal: true,
    hasBackdrop: true,
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    autoFocus: 'first-tabbable',
  });
  return await new Promise<RoleCreateDialogResult>((resolve) => {
    const sub = ref.closed.subscribe((value) => {
      resolve(value ?? null);
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
