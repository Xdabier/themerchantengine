import { isPlatformBrowser } from '@angular/common';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { UsersService } from '@storefront-services';
import {
  StorefrontError,
  StorefrontUnauthorizedError,
  type Address,
  type CreateAddressRequest,
  type UpdateAddressRequest,
} from '@storefront-types';

import { LocaleService } from '../../../../locale.service';
import { AuthStateService } from '../../../../services/auth-state.service';
import { APP_ROUTES } from '../../../../../lib/routes';
import { AddressCardComponent } from '../../../../sections/account/address-card.component';
import {
  AddressFormComponent,
  type AddressFormSubmit,
} from '../../../../sections/account/address-form.component';
import { ButtonComponent } from '../../../../ui/button.component';
import { SpinnerComponent } from '../../../../ui/spinner.component';
import { ensureAuthedForAccount } from '../_account-auth-guard';
import { AccountNavComponent } from '../../../../sections/account/account-nav.component';
import { pageTitle } from '../../../../../lib/seo';

type PageState = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-account-addresses-page',
  standalone: true,
  imports: [
    AccountNavComponent,
    AddressCardComponent,
    AddressFormComponent,
    ButtonComponent,
    CdkTrapFocus,
    SpinnerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page" data-testid="account-addresses-page">
      <app-account-nav />
      <header class="header">
        <h1 class="title">{{ strings().account.addresses.heading }}</h1>
        @if (state() === 'ready' && !isFormVisible()) {
          <app-button
            variant="primary"
            size="md"
            testId="account-addresses-add-cta"
            (clicked)="onAdd()"
          >
            {{ strings().account.addresses.addCta }}
          </app-button>
        }
      </header>

      @if (mutationMessage()) {
        <p
          class="status-message"
          role="status"
          aria-live="polite"
          data-testid="account-addresses-status"
        >
          {{ mutationMessage() }}
        </p>
      }

      @switch (state()) {
        @case ('loading') {
          <div
            class="loading"
            role="status"
            aria-live="polite"
            data-testid="account-addresses-loading"
          >
            <app-spinner size="md" />
            <span>{{ strings().account.shared.loading }}</span>
          </div>
        }
        @case ('error') {
          <p class="error" role="alert" data-testid="account-addresses-error">
            {{ strings().account.shared.loadError }}
          </p>
        }
        @case ('ready') {
          @if (isFormVisible()) {
            <app-address-form
              [initialAddress]="editing()"
              [saving]="saving()"
              [externalError]="formError()"
              (submit)="onFormSubmit($event)"
              (cancel)="onFormCancel()"
            />
          }

          @if (addresses().length === 0 && !isFormVisible()) {
            <div class="empty" data-testid="account-addresses-empty">
              <h2 class="empty-title">{{ strings().account.addresses.empty.title }}</h2>
              <p class="empty-body">{{ strings().account.addresses.empty.body }}</p>
            </div>
          } @else {
            <ul class="cards" data-testid="account-addresses-list">
              @for (a of addresses(); track a.id) {
                <li class="card-item">
                  <app-address-card
                    [address]="a"
                    [busy]="busyId() === a.id"
                    (edit)="onEdit($event)"
                    (remove)="onRemove($event)"
                    (setDefault)="onSetDefault($event)"
                  />
                </li>
              }
            </ul>
          }

          @if (confirmDelete(); as target) {
            <div
              class="delete-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="account-addresses-delete-title"
              aria-describedby="account-addresses-delete-body"
              data-testid="account-addresses-delete-confirm"
              cdkTrapFocus
              cdkTrapFocusAutoCapture
            >
              <h3 id="account-addresses-delete-title" class="delete-confirm-title">
                {{ strings().account.addresses.deleteConfirm.title }}
              </h3>
              <p id="account-addresses-delete-body">
                {{ strings().account.addresses.deleteConfirm.body }}
              </p>
              <div class="delete-confirm-actions">
                <app-button
                  variant="tertiary"
                  size="md"
                  testId="account-addresses-delete-cancel"
                  (clicked)="dismissDelete()"
                >
                  {{ strings().account.addresses.deleteConfirm.no }}
                </app-button>
                <app-button
                  variant="primary"
                  size="md"
                  [loading]="busyId() === target.id"
                  testId="account-addresses-delete-confirm-yes"
                  (clicked)="confirmDeleteAddress(target)"
                >
                  {{ strings().account.addresses.deleteConfirm.yes }}
                </app-button>
              </div>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .page {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        padding-block: 1.5rem;
        padding-inline: 1rem;
        max-inline-size: 1280px;
        margin-inline: auto;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        color: var(--brand-text);
      }
      .status-message {
        margin: 0;
        padding-block: 0.625rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-surface);
        color: var(--brand-text);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-sm);
      }
      .cards {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.875rem;
      }
      @media (min-width: 768px) {
        .cards {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      .empty {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-block: 2rem;
      }
      .empty-title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .empty-body {
        margin: 0;
        color: var(--brand-text-muted);
      }
      .delete-confirm {
        background-color: var(--brand-surface-strong);
        border: 1px solid var(--brand-border);
        border-radius: var(--brand-radius-md);
        padding-block: 1rem;
        padding-inline: 1rem;
      }
      .delete-confirm-title {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md section title */
        font-size: var(--brand-text-section);
        font-weight: 600;
        color: var(--brand-text);
      }
      .delete-confirm-actions {
        display: flex;
        gap: 0.5rem;
        margin-block-start: 0.5rem;
      }
      .loading {
        display: inline-flex;
        gap: 0.5rem;
        align-items: center;
        color: var(--brand-text-muted);
        padding-block: 1rem;
      }
      .error {
        margin: 0;
        padding-block: 0.75rem;
        padding-inline: 0.875rem;
        background-color: var(--brand-surface-strong);
        color: var(--brand-error);
        border-inline-start: 3px solid var(--brand-error);
        border-radius: var(--brand-radius-sm);
      }
    `,
  ],
})
export class AccountAddressesPageComponent implements OnInit {
  private readonly locale = inject(LocaleService);
  private readonly authState = inject(AuthStateService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly users = inject(UsersService);

  protected readonly strings = this.locale.strings;
  protected readonly state = signal<PageState>('idle');
  protected readonly addresses = signal<Address[]>([]);
  protected readonly editing = signal<Address | null>(null);
  protected readonly isFormVisible = signal<boolean>(false);
  protected readonly saving = signal<boolean>(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly mutationMessage = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly confirmDelete = signal<Address | null>(null);

  ngOnInit(): void {
    this.title.setTitle(
      pageTitle(this.strings().account.meta.addressesTitle, this.strings().brand.name),
    );
    this.meta.updateTag({ name: 'robots', content: 'noindex,nofollow' });

    if (!isPlatformBrowser(this.platformId)) return;
    void this.init();
  }

  /**
   * Browser-side entry. The state flips to `'loading'` BEFORE the guard is
   * awaited so the page never sits in the unrendered `'idle'` branch while
   * the session boot settles (finding N4).
   */
  private async init(): Promise<void> {
    this.state.set('loading');
    if (
      !(await ensureAuthedForAccount(
        { authState: this.authState, locale: this.locale, router: this.router },
        APP_ROUTES.account.addresses(this.locale.locale()),
      ))
    ) {
      return;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    this.state.set('loading');
    try {
      const me = await this.users.getMe();
      this.addresses.set((me.addresses as Address[] | undefined) ?? []);
      this.state.set('ready');
    } catch (cause) {
      if (cause instanceof StorefrontUnauthorizedError) {
        this.authState.clearSession();
        void ensureAuthedForAccount(
          { authState: this.authState, locale: this.locale, router: this.router },
          APP_ROUTES.account.addresses(this.locale.locale()),
        );
        return;
      }
      if (cause instanceof StorefrontError) {
        this.state.set('error');
        return;
      }
      this.state.set('error');
    }
  }

  protected onAdd(): void {
    this.editing.set(null);
    this.formError.set(null);
    this.isFormVisible.set(true);
  }

  protected onEdit(address: Address): void {
    this.editing.set(address);
    this.formError.set(null);
    this.isFormVisible.set(true);
  }

  protected onFormCancel(): void {
    this.editing.set(null);
    this.isFormVisible.set(false);
    this.formError.set(null);
  }

  protected async onFormSubmit(payload: AddressFormSubmit): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.formError.set(null);
    const editing = this.editing();
    try {
      let saved: Address;
      if (editing) {
        saved = await this.users.updateAddress(editing.id, payload.payload as UpdateAddressRequest);
      } else {
        saved = await this.users.createAddress(payload.payload as CreateAddressRequest);
      }
      if (payload.isDefault && saved.isDefaultShipping !== true) {
        try {
          await this.users.setDefaultAddress(saved.id, { isDefaultShipping: true });
        } catch {
          // The address still saved successfully; the default flag merely
          // failed to flip. Surface the failure as a non-fatal note rather
          // than rolling back the create/update.
          this.formError.set(this.strings().account.addresses.errors.generic);
        }
      }
      await this.load();
      this.editing.set(null);
      this.isFormVisible.set(false);
      this.mutationMessage.set(this.strings().account.addresses.saved);
    } catch (cause) {
      if (cause instanceof StorefrontUnauthorizedError) {
        this.authState.clearSession();
        void ensureAuthedForAccount(
          { authState: this.authState, locale: this.locale, router: this.router },
          APP_ROUTES.account.addresses(this.locale.locale()),
        );
        return;
      }
      this.formError.set(this.strings().account.addresses.errors.generic);
    } finally {
      this.saving.set(false);
    }
  }

  protected onRemove(address: Address): void {
    this.confirmDelete.set(address);
  }

  protected dismissDelete(): void {
    this.confirmDelete.set(null);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.confirmDelete()) this.dismissDelete();
  }

  protected async confirmDeleteAddress(address: Address): Promise<void> {
    this.busyId.set(address.id);
    try {
      await this.users.deleteAddress(address.id);
      await this.load();
      this.mutationMessage.set(this.strings().account.addresses.deleted);
    } catch {
      this.formError.set(this.strings().account.addresses.errors.generic);
    } finally {
      this.busyId.set(null);
      this.confirmDelete.set(null);
    }
  }

  protected async onSetDefault(address: Address): Promise<void> {
    this.busyId.set(address.id);
    try {
      await this.users.setDefaultAddress(address.id, { isDefaultShipping: true });
      await this.load();
      this.mutationMessage.set(this.strings().account.addresses.defaultSet);
    } catch (err: unknown) {
      this.formError.set(this.setDefaultErrorMessageFor(err));
    } finally {
      this.busyId.set(null);
    }
  }

  /**
   * Map a set-default-address failure to localized copy. Backend emits
   * `ADDRESS_DEFAULT_FLAG_REQUIRED` (B2 row #26) when the storefront sends
   * the endpoint without `isDefaultShipping` or `isDefaultBilling` true.
   * The storefront onSetDefault path always sends one flag today, so this
   * branch is defense-in-depth — the dispatch is structurally code-aware
   * even when the unknown-code fallback maps to the same generic copy.
   */
  private setDefaultErrorMessageFor(err: unknown): string {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : null;
    if (code === 'ADDRESS_DEFAULT_FLAG_REQUIRED')
      return this.strings().account.addresses.errors.generic;
    return this.strings().account.addresses.errors.generic;
  }
}

export default AccountAddressesPageComponent;
