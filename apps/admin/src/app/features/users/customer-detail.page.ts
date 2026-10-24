import { Dialog } from '@angular/cdk/dialog';
import { ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  LoadErrorComponent,
  SkeletonComponent,
  openConfirmDialog,
} from '@admin-ui';
import {
  OrdersService,
  ReviewsService,
  UsersService,
  type Customer,
  type CustomerAddress,
  type Order,
  type Review,
  type UpdateCustomerRequest,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  fullName,
  initials,
  segmentLabel,
  segmentTone,
  statusLabel,
  statusTone,
} from './users.utils';
import { orderStatusLabel, orderStatusTone } from '../orders/orders.utils';
import { renderStars, reviewStatusTone } from '../reviews/reviews.utils';
import { humanizeCode } from '../../shared/format/enum-label';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { TranslatablePipe } from '../../shared/pipes/translatable.pipe';

/**
 * `/customers/:id` — customer profile + lightweight admin edit surface.
 *
 * Admin-editable fields are limited to contact info + `isActive`. Roles
 * and permissions are off-limits for customers — staff changes are on a
 * separate screen. Deactivation uses a confirm dialog so accidental
 * clicks don't silently lock accounts out.
 */
@Component({
  selector: 'app-customer-detail-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    LoadErrorComponent,
    SkeletonComponent,
    MoneyPipe,
    AdminDatePipe,
    TranslatablePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="customer-detail-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/customers"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Customers
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">
          {{ current() ? name(current()!) : '…' }}
        </span>
      </nav>

      <div role="status" aria-live="polite" data-testid="customer-detail-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="3rem" width="40%" />
          <app-skeleton height="12rem" width="100%" />
        </div>
      } @else if (current(); as c) {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="flex items-center gap-5 min-w-0">
            <div
              class="flex items-center justify-center w-14 h-14 border border-line text-ink text-lg font-bold tabular"
              aria-hidden="true"
              data-testid="customer-avatar"
            >
              {{ avatar(c) }}
            </div>
            <div class="min-w-0">
              <p class="text-xs tracking-widest uppercase text-ink-muted">Customer</p>
              <h1 class="mt-1 text-3xl md:text-4xl font-bold tracking-tight truncate">
                {{ name(c) }}
              </h1>
              <p class="mt-2 tabular text-sm text-ink-muted truncate">{{ c.email }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <app-badge
              [tone]="statusTone(c.status)"
              [ariaLabel]="'Status: ' + statusLabel(c.status)"
            >
              {{ statusLabel(c.status) }}
            </app-badge>
            @if (c.segment) {
              <app-badge
                [tone]="segmentTone(c.segment)"
                [ariaLabel]="'Segment: ' + segmentLabel(c.segment)"
              >
                {{ segmentLabel(c.segment) }}
              </app-badge>
            }
            <span aria-live="polite" class="inline-flex">
              @if (saved()) {
                <app-badge tone="success" [ariaLabel]="'Changes saved'">Saved</app-badge>
              }
            </span>
          </div>
        </header>

        <dl
          class="grid grid-cols-1 md:grid-cols-3 gap-6 border border-line p-5"
          aria-label="Customer overview"
        >
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Orders</dt>
            <dd
              class="mt-1 text-2xl font-bold tabular-nums text-ink"
              data-testid="customer-order-count"
            >
              {{ c.orderCount ?? 0 }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Lifetime value</dt>
            <dd
              class="mt-1 text-2xl font-bold tabular-nums text-ink"
              data-testid="customer-lifetime-value"
            >
              {{ c.totalSpent ?? 0 | money }}
            </dd>
          </div>
          <div>
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Reviews</dt>
            <dd
              class="mt-1 text-2xl font-bold tabular-nums text-ink"
              data-testid="customer-review-count"
            >
              {{ c.reviewCount ?? 0 }}
            </dd>
          </div>
        </dl>

        <section class="flex flex-col gap-4" data-testid="customer-orders-section">
          <header class="flex items-end justify-between gap-4 flex-wrap">
            <h2 class="text-xs tracking-widest uppercase text-ink-muted">Orders</h2>
            @if (orders().length > 0) {
              <a
                [routerLink]="['/orders']"
                [queryParams]="{ userId: c.id }"
                class="tabular text-xs text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                data-testid="customer-orders-view-all"
              >
                View all orders
              </a>
            }
          </header>

          @if (ordersError()) {
            <app-load-error
              [message]="ordersError()!"
              [compact]="true"
              [retrying]="ordersLoading()"
              retryLabel="orders"
              testId="customer-orders-degraded"
              (retry)="fetchOrders(c.id)"
            />
          } @else if (ordersLoading()) {
            <app-skeleton height="6rem" width="100%" />
          } @else if (orders().length === 0) {
            <p class="tabular text-sm text-ink-muted">This customer has not ordered yet.</p>
          } @else {
            <div class="border border-line">
              <div class="overflow-x-auto">
                <table class="w-full border-collapse">
                  <caption class="sr-only">
                    Orders placed by this customer
                  </caption>
                  <thead class="border-b border-line">
                    <tr class="text-left">
                      <th scope="col" class="{{ cellHead }}">Order</th>
                      <th scope="col" class="{{ cellHead }}">Placed</th>
                      <th scope="col" class="{{ cellHead }}">Total</th>
                      <th scope="col" class="{{ cellHead }}">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (o of orders(); track o.id) {
                      <tr
                        class="border-b border-line last:border-b-0"
                        [attr.data-testid]="'customer-order-' + o.id"
                      >
                        <td class="px-4 py-3">
                          <a
                            [routerLink]="['/orders', o.id]"
                            class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                          >
                            {{ o.orderNumber ?? o.number ?? o.id }}
                          </a>
                        </td>
                        <td class="px-4 py-3 tabular text-sm text-ink-muted">
                          {{ o.createdAt | adminDate }}
                        </td>
                        <td class="px-4 py-3 tabular text-sm tabular-nums text-ink">
                          {{ o.total ?? 0 | money }}
                        </td>
                        <td class="px-4 py-3">
                          <app-badge
                            [tone]="orderTone(o.status)"
                            [ariaLabel]="'Order status: ' + orderStatusLabel(o.status)"
                          >
                            {{ orderStatusLabel(o.status) }}
                          </app-badge>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </section>

        <section class="flex flex-col gap-4" data-testid="customer-addresses-section">
          <h2 class="text-xs tracking-widest uppercase text-ink-muted">Addresses</h2>
          @if (addresses().length === 0) {
            <p class="tabular text-sm text-ink-muted">No address on file.</p>
          } @else {
            <ul class="grid grid-cols-1 md:grid-cols-2 gap-4">
              @for (a of addresses(); track a.id) {
                <li
                  class="border border-line p-4 flex flex-col gap-2"
                  [attr.data-testid]="'customer-address-' + a.id"
                >
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="tabular text-sm text-ink">{{
                      a.label || a.fullName || 'Address'
                    }}</span>
                    @if (a.isDefaultShipping) {
                      <app-badge tone="info" ariaLabel="Default shipping address"
                        >Shipping</app-badge
                      >
                    }
                    @if (a.isDefaultBilling) {
                      <app-badge tone="info" ariaLabel="Default billing address">Billing</app-badge>
                    }
                  </div>
                  <p class="tabular text-sm text-ink-muted">{{ addressLines(a) }}</p>
                  @if (a.phone) {
                    <p class="tabular text-xs text-ink-muted">{{ a.phone }}</p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <section class="flex flex-col gap-4" data-testid="customer-reviews-section">
          <h2 class="text-xs tracking-widest uppercase text-ink-muted">Reviews</h2>

          @if (reviewsError()) {
            <app-load-error
              [message]="reviewsError()!"
              [compact]="true"
              [retrying]="reviewsLoading()"
              retryLabel="reviews"
              testId="customer-reviews-degraded"
              (retry)="fetchReviews(c.id)"
            />
          } @else if (reviewsLoading()) {
            <app-skeleton height="4rem" width="100%" />
          } @else if (reviews().length === 0) {
            <p class="tabular text-sm text-ink-muted">This customer has not reviewed anything.</p>
          } @else {
            <ul class="flex flex-col gap-3">
              @for (r of reviews(); track r.id) {
                <li
                  class="border border-line p-4 flex flex-col gap-2"
                  [attr.data-testid]="'customer-review-' + r.id"
                >
                  <div class="flex items-center justify-between gap-3 flex-wrap">
                    <a
                      [routerLink]="['/reviews', r.id]"
                      class="tabular text-sm text-ink hover:underline focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                    >
                      {{ r.title | translatable: reviewFallback(r) }}
                    </a>
                    <app-badge
                      [tone]="reviewTone(r.status)"
                      [ariaLabel]="'Review status: ' + reviewStatusLabel(r.status)"
                    >
                      {{ reviewStatusLabel(r.status) }}
                    </app-badge>
                  </div>
                  <p class="tabular text-xs text-ink-muted">
                    <span aria-hidden="true">{{ stars(r.rating) }}</span>
                    <span class="sr-only">{{ r.rating }} out of 5</span>
                    <span class="ms-2">{{ r.createdAt | adminDate }}</span>
                  </p>
                </li>
              }
            </ul>
          }
        </section>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <app-form-field label="First name" fieldId="cust-first">
              <app-input id="cust-first" type="text" formControlName="firstName"></app-input>
            </app-form-field>
            <app-form-field label="Last name" fieldId="cust-last">
              <app-input id="cust-last" type="text" formControlName="lastName"></app-input>
            </app-form-field>
          </div>
          <app-form-field
            label="Email"
            fieldId="cust-email"
            [error]="emailError()"
            hint="Change with care — the storefront uses this to authenticate."
          >
            <app-input
              id="cust-email"
              type="email"
              formControlName="email"
              [invalid]="!!emailError()"
            ></app-input>
          </app-form-field>
          <app-form-field label="Phone" fieldId="cust-phone">
            <app-input id="cust-phone" type="tel" formControlName="phone"></app-input>
          </app-form-field>

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex flex-wrap items-center justify-between gap-3"
          >
            <div class="flex items-center gap-3">
              @if (canDeactivate() && c.status === 'active') {
                <app-button
                  type="button"
                  variant="destructive"
                  size="sm"
                  [disabled]="busy()"
                  [loading]="busy() && action() === 'deactivate'"
                  (clicked)="confirmDeactivate()"
                  data-testid="customer-deactivate"
                >
                  Deactivate account
                </app-button>
              } @else if (canDeactivate() && c.status !== 'active') {
                <app-button
                  type="button"
                  variant="secondary"
                  size="sm"
                  [disabled]="busy()"
                  [loading]="busy() && action() === 'activate'"
                  (clicked)="reactivate()"
                  data-testid="customer-reactivate"
                >
                  Reactivate
                </app-button>
              }
              <p class="text-xs tabular text-ink-muted">
                {{ form.dirty ? 'Unsaved changes' : 'No changes' }}
              </p>
            </div>
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="ghost"
                size="sm"
                [disabled]="busy()"
                routerLink="/customers"
                data-testid="customer-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || !form.dirty"
                [loading]="busy() && action() === 'save'"
                data-testid="customer-save"
              >
                Save changes
              </app-button>
            </div>
          </footer>
        </form>
      }
    </section>
  `,
})
export class CustomerDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly users = inject(UsersService);
  private readonly orderService = inject(OrdersService);
  private readonly reviewService = inject(ReviewsService);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  /** Shared header cell classes for the inline orders table. */
  protected readonly cellHead =
    'text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3';

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<Customer | null>(null);
  readonly busy = signal(false);
  readonly action = signal<'save' | 'deactivate' | 'activate' | null>(null);
  readonly saved = signal(false);

  readonly orders = signal<readonly Order[]>([]);
  readonly ordersLoading = signal(false);
  readonly ordersError = signal<string | null>(null);
  readonly reviews = signal<readonly Review[]>([]);
  readonly reviewsLoading = signal(false);
  readonly reviewsError = signal<string | null>(null);

  /** Addresses ride along on the detail payload; no second request. */
  readonly addresses = computed(() => this.current()?.addresses ?? []);

  readonly canDeactivate = computed(() =>
    this.authStore.hasAnyPermission(['customers:manage', 'customers:update']),
  );

  protected readonly name = fullName;
  protected readonly avatar = initials;
  protected readonly statusTone = statusTone;
  protected readonly statusLabel = statusLabel;
  protected readonly segmentTone = segmentTone;
  protected readonly segmentLabel = segmentLabel;
  protected readonly orderStatusLabel = orderStatusLabel;
  protected readonly orderTone = orderStatusTone;
  protected readonly reviewTone = reviewStatusTone;
  protected readonly reviewStatusLabel = humanizeCode;
  protected readonly stars = renderStars;

  readonly form = this.fb.nonNullable.group({
    firstName: this.fb.nonNullable.control(''),
    lastName: this.fb.nonNullable.control(''),
    email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
    phone: this.fb.nonNullable.control(''),
  });

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((p) => {
      const id = p.get('id');
      if (!id) return;
      this.fetch(id);
      this.fetchOrders(id);
      this.fetchReviews(id);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** One-line postal address from the Prisma `Address` columns. */
  addressLines(a: CustomerAddress): string {
    return [a.addressLine1, a.addressLine2, a.city, a.state, a.postalCode, a.country]
      .filter(Boolean)
      .join(', ');
  }

  /** Reviews may carry no title; fall back to the product they belong to. */
  reviewFallback(r: Review): string {
    return r.product?.slug ?? 'Review';
  }

  /** First page of the customer's orders, filtered server-side by `userId`. */
  fetchOrders(customerId: string): void {
    this.ordersLoading.set(true);
    this.ordersError.set(null);
    this.orderService
      .list({ userId: customerId, page: 1, pageSize: 10, sortBy: 'createdAt', sortOrder: 'desc' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.orders.set(res.data);
          this.ordersLoading.set(false);
        },
        error: () => {
          this.orders.set([]);
          this.ordersLoading.set(false);
          this.ordersError.set('Could not load this customer’s orders.');
        },
      });
  }

  fetchReviews(customerId: string): void {
    this.reviewsLoading.set(true);
    this.reviewsError.set(null);
    this.reviewService
      .listReviews({ userId: customerId, page: 1, pageSize: 10 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.reviews.set(res.data);
          this.reviewsLoading.set(false);
        },
        error: () => {
          this.reviews.set([]);
          this.reviewsLoading.set(false);
          this.reviewsError.set('Could not load this customer’s reviews.');
        },
      });
  }

  emailError(): string | null {
    const c = this.form.controls.email;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Email is required.';
    if (c.hasError('email')) return 'Enter a valid email address.';
    return null;
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy() || !this.form.dirty) {
      if (this.form.invalid) this.focusFirstInvalid();
      return;
    }

    const raw = this.form.getRawValue();
    const dirty = this.form.controls;
    const body: UpdateCustomerRequest = {};
    if (dirty.firstName.dirty) body.firstName = raw.firstName;
    if (dirty.lastName.dirty) body.lastName = raw.lastName;
    if (dirty.email.dirty) body.email = raw.email;
    if (dirty.phone.dirty) body.phone = raw.phone;

    this.startAction('save');
    this.users.updateCustomer(this.current()!.id, body).subscribe({
      next: (updated) => {
        this.current.set(updated);
        this.form.markAsPristine();
        this.finishAction();
      },
      error: (err: unknown) => this.failAction(err, 'Could not save customer.'),
    });
  }

  async confirmDeactivate(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Deactivate this customer?',
      body: 'The customer will be unable to sign in or check out until you reactivate them. Their order history stays intact.',
      confirmLabel: 'Deactivate',
      tone: 'destructive',
    });
    if (!ok) return;
    this.patchActive('deactivate', false);
  }

  reactivate(): void {
    this.patchActive('activate', true);
  }

  private patchActive(kind: 'deactivate' | 'activate', isActive: boolean): void {
    const current = this.current();
    if (!current) return;
    this.startAction(kind);
    this.users.updateCustomer(current.id, { isActive }).subscribe({
      next: (updated) => {
        this.current.set(updated);
        this.finishAction();
      },
      error: (err: unknown) => this.failAction(err, 'Could not update customer.'),
    });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.users
      .getCustomer(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (c) => {
          this.current.set(c);
          this.seedForm(c);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(c: Customer): void {
    this.form.reset(
      {
        firstName: c.firstName ?? '',
        lastName: c.lastName ?? '',
        email: c.email,
        phone: c.phone ?? '',
      },
      { emitEvent: false },
    );
  }

  private startAction(kind: 'save' | 'deactivate' | 'activate'): void {
    this.busy.set(true);
    this.action.set(kind);
    this.error.set(null);
    this.saved.set(false);
  }

  private finishAction(): void {
    this.busy.set(false);
    this.action.set(null);
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 3000);
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.error.set(this.formatError(err, fallback));
  }

  private focusFirstInvalid(): void {
    queueMicrotask(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      el?.focus();
    });
  }

  private formatError(err: unknown, fallback = 'Could not load customer.'): string {
    if (err instanceof ApiNotFoundError) return 'Customer not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to modify customers.';
    if (err instanceof ApiConflictError) return 'Email already in use on another account.';
    if (err instanceof Error && err.message) return err.message;
    return fallback;
  }
}
