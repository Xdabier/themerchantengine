import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  DropzoneComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TabStripComponent,
  TranslatableInputComponent,
  TranslatableRichTextComponent,
  type DropzoneFileRejection,
  type TabStripItem,
  type TranslatableValue,
  openAssetPicker,
  openConfirmDialog,
} from '@admin-ui';
import {
  AssetsService,
  AuditLogService,
  ProductsService,
  type Asset,
  type AuditLogEntry,
  type Product,
  type ProductStock,
  type ProductStockVariant,
  type UpdateProductRequest,
  type Variant,
} from '@admin-services';
import { ApiConflictError, ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { actionLabel, actorName } from '../audit-logs/audit-logs.utils';
import { pickTranslatable, productStatusTone } from './products.utils';
import {
  VariantDialogComponent,
  type VariantDialogData,
  type VariantDialogResult,
} from './variant-dialog.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { AdminDatePipe } from '../../shared/pipes/admin-date.pipe';
import { pluralize } from '../../shared/format/pluralize';
import { CategoryPickerComponent } from '../../shared/components/category-picker.component';
import { ProductSpecsMatrixComponent } from './product-specs-matrix.component';
import { createSpecLabelSource } from './product-specs.source';
import { openStockPanel } from './product-stock-panel.component';
import { StorefrontLinkComponent } from '../../shared/components/storefront-link.component';
import { translatableRequired } from '../../shared/validators/translatable-required.validator';
import type { Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

type EditorTab = 'general' | 'pricing' | 'variants' | 'media' | 'specs' | 'seo' | 'history';

interface ProductAssetRow {
  assetId: string;
  sortOrder: number;
  isPrimary: boolean;
  /**
   * Preview envelope hydrated from the admin GET response (S16) or from
   * a fresh upload. Optional because legacy rows persisted before S16
   * landed will not carry it; the template renders a metadata-only cell
   * in that case.
   *
   * AV3 — `status` + `variants` widen the envelope so the resolver shim
   * (`AssetsService.tryPublicVariantUrl`) can pick a variant URL for
   * Media-tab tiles instead of binding raw `asset.url`. Both optional so
   * legacy GET responses without the AV3 backend select widening (AV3.18)
   * still parse — the shim returns null and the template falls back to
   * the type-label block.
   */
  asset?: {
    id: string;
    url: string;
    type: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO';
    alt?: Translatable | string | null;
    status?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
    variants?: unknown;
  };
}

/**
 * `/products/:id/edit` — editor surface.
 *
 * Tabs: General, Pricing (read-only default-variant), Variants (full CRUD
 * via a side-panel dialog), SEO, History (audit log filtered to this
 * product).
 *
 * Save flow
 * - One PATCH per save. The form tracks only dirty fields so unchanged
 *   Translatable keys are not re-sent (prevents spurious audit-log rows).
 * - Status toggle from DRAFT→ACTIVE triggers a neutral-tone confirm dialog
 *   (publishing is user-visible; going back to DRAFT is not).
 * - Permission: `products:update` is required to mount the page;
 *   auth.route guard enforces.
 */
@Component({
  selector: 'app-product-edit-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    DropzoneComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TabStripComponent,
    TranslatableInputComponent,
    TranslatableRichTextComponent,
    MoneyPipe,
    AdminDatePipe,
    CategoryPickerComponent,
    ProductSpecsMatrixComponent,
    StorefrontLinkComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="p-6 md:p-10 flex flex-col gap-8"
      data-testid="product-edit-page"
      [attr.aria-busy]="loading() ? 'true' : null"
    >
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/products"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Products
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        @if (product()) {
          <a
            [routerLink]="['/products', product()!.id]"
            class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >
            {{ pickTranslatable(product()!.name) }}
          </a>
          <span aria-hidden="true" class="mx-2">/</span>
          <span class="text-ink" aria-current="page">Edit</span>
        }
      </nav>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          data-testid="product-edit-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2.5rem" width="40%" />
          <app-skeleton height="1rem" width="60%" />
          <app-skeleton height="18rem" width="100%" />
        </div>
      } @else if (product(); as p) {
        <header class="flex flex-wrap items-end justify-between gap-6">
          <div class="flex-1 min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">Edit product</p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight truncate">
              {{ pickTranslatable(p.name) }}
            </h1>
            <p class="mt-3 tabular text-sm text-ink-muted">/{{ p.slug }}</p>
            <app-storefront-link
              class="mt-2 block"
              [slug]="p.slug"
              [status]="currentStatus()"
              [productName]="pickTranslatable(p.name)"
            />
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <app-badge
              [tone]="statusTone(currentStatus())"
              [ariaLabel]="'Current status: ' + currentStatus()"
            >
              {{ currentStatus() }}
            </app-badge>
            @if (saved()) {
              <app-badge tone="success" [ariaLabel]="'Changes saved'">Saved</app-badge>
            }
          </div>
        </header>

        <form [formGroup]="form" (ngSubmit)="save()" class="flex flex-col gap-6" novalidate>
          <app-tab-strip
            [tabs]="tabs"
            [active]="tab()"
            [ariaLabel]="'Product editor sections'"
            idPrefix="product-editor"
            testId="product-editor-tabs"
            (tabChanged)="setTab($event)"
          />

          @if (tab() === 'general') {
            <div
              role="tabpanel"
              id="product-editor-panel-general"
              aria-labelledby="product-editor-general"
              class="flex flex-col gap-5"
              data-testid="product-editor-general"
            >
              <app-form-field label="Name" fieldId="product-name" [required]="true">
                <app-translatable-input
                  formControlName="name"
                  label="Name"
                  inputId="product-name"
                  idPrefix="product-name"
                  testId="product-name"
                ></app-translatable-input>
              </app-form-field>

              <app-form-field
                label="Slug"
                fieldId="product-slug"
                [error]="slugError()"
                hint="Lowercase, hyphen-separated. Visible in the public URL."
              >
                <app-input
                  id="product-slug"
                  type="text"
                  formControlName="slug"
                  [invalid]="!!slugError()"
                ></app-input>
              </app-form-field>

              <app-form-field label="Short description" fieldId="product-short-description">
                <app-translatable-input
                  formControlName="shortDescription"
                  label="Short description"
                  inputId="product-short-description"
                  idPrefix="product-short-description"
                  testId="product-short-description"
                  [multiline]="true"
                  [rows]="2"
                ></app-translatable-input>
              </app-form-field>

              <app-form-field label="Description" fieldId="product-description">
                <app-translatable-rich-text
                  formControlName="description"
                  label="Description"
                  idPrefix="product-description"
                  inputId="product-description"
                  testId="product-description"
                ></app-translatable-rich-text>
              </app-form-field>

              <app-form-field label="Brand" fieldId="product-brand">
                <app-input id="product-brand" type="text" formControlName="brand"></app-input>
              </app-form-field>

              <app-category-picker
                [selectedIds]="selectedCategoryList()"
                (selectionChange)="onCategorySelectionChange($event)"
              />
            </div>
          }

          @if (tab() === 'pricing') {
            <div
              role="tabpanel"
              id="product-editor-panel-pricing"
              aria-labelledby="product-editor-pricing"
              class="flex flex-col gap-5"
              data-testid="product-editor-pricing"
            >
              <p class="tabular text-sm text-ink-muted max-w-2xl">
                Pricing is per-variant — use the Variants tab to edit SKU, price, compare-at, cost,
                and weight. This tab summarises the default variant.
              </p>
              @if (defaultVariant(); as v) {
                <dl class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div class="border border-line bg-surface p-5">
                    <dt class="text-xs tracking-widest uppercase text-ink-muted">Default SKU</dt>
                    <dd class="mt-2 tabular text-sm" data-testid="edit-default-sku">{{ v.sku }}</dd>
                  </div>
                  <div class="border border-line bg-surface p-5">
                    <dt class="text-xs tracking-widest uppercase text-ink-muted">Default price</dt>
                    <dd class="mt-2 tabular text-sm tabular-nums" data-testid="edit-default-price">
                      {{ v.price | money }}
                    </dd>
                  </div>
                </dl>
              } @else {
                <p class="tabular text-sm text-ink-muted">No variants yet.</p>
              }
            </div>
          }

          @if (tab() === 'variants') {
            <div
              role="tabpanel"
              id="product-editor-panel-variants"
              aria-labelledby="product-editor-variants"
              class="flex flex-col gap-5"
              data-testid="product-editor-variants"
            >
              @if (stockError()) {
                <p
                  class="border border-status-error text-ink p-3 tabular text-xs"
                  role="alert"
                  data-testid="product-stock-load-error"
                >
                  {{ stockError() }}
                </p>
              }

              <header class="flex items-center justify-between gap-3">
                <p class="tabular text-sm text-ink-muted">
                  {{ pluralize(product()?.variants?.length ?? 0, 'variant') }}.
                </p>
                <app-button
                  type="button"
                  variant="primary"
                  size="sm"
                  [disabled]="busy()"
                  (clicked)="openVariantDialog(null)"
                  data-testid="product-variant-add"
                >
                  Add variant
                </app-button>
              </header>

              @if (!product()?.variants?.length) {
                <p class="tabular text-sm text-ink-muted py-8 text-center border border-line">
                  No variants yet.
                </p>
              } @else {
                <div class="overflow-x-auto border border-line">
                  <table class="w-full border-collapse">
                    <caption class="sr-only">
                      Product variants
                    </caption>
                    <thead class="border-b border-line">
                      <tr class="text-left">
                        <th
                          scope="col"
                          class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                        >
                          SKU
                        </th>
                        <th
                          scope="col"
                          class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                        >
                          Price
                        </th>
                        <th
                          scope="col"
                          class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                        >
                          Default
                        </th>
                        <th
                          scope="col"
                          class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                        >
                          Active
                        </th>
                        @if (canViewStock()) {
                          <th
                            scope="col"
                            class="text-xs tracking-widest uppercase text-ink-muted font-normal px-4 py-3"
                          >
                            Stock
                          </th>
                        }
                        <th scope="col" class="px-4 py-3">
                          <span class="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (v of product()?.variants; track v.id) {
                        <tr class="border-b border-line last:border-b-0">
                          <td class="px-4 py-3 tabular text-sm text-ink">{{ v.sku }}</td>
                          <td class="px-4 py-3 tabular text-sm tabular-nums">
                            {{ v.price | money }}
                          </td>
                          <td class="px-4 py-3 tabular text-sm text-ink-muted">
                            {{ v.isDefault ? 'Yes' : '—' }}
                          </td>
                          <td class="px-4 py-3 tabular text-sm text-ink-muted">
                            {{ v.isActive ? 'Yes' : 'No' }}
                          </td>
                          @if (canViewStock()) {
                            <td class="px-4 py-3 tabular text-sm">
                              @if (stockFor(v.id); as st) {
                                <span class="tabular-nums text-ink">{{ st.totals.available }}</span>
                                <span class="block text-xs tabular text-ink-muted">
                                  {{ st.totals.onHand }} on hand · {{ st.totals.reserved }} reserved
                                </span>
                              } @else {
                                <span class="text-ink-muted">—</span>
                              }
                            </td>
                          }
                          <td class="px-4 py-3 text-right">
                            <div class="flex items-center gap-1 justify-end">
                              @if (canUpdateStock()) {
                                <app-button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  (clicked)="openStock(v)"
                                  [testId]="'product-variant-stock-' + v.id"
                                  [ariaLabel]="'Set stock for ' + v.sku"
                                >
                                  Stock
                                </app-button>
                              }
                              <app-button
                                type="button"
                                variant="secondary"
                                size="sm"
                                (clicked)="openVariantDialog(v)"
                                [attr.data-testid]="'product-variant-edit-' + v.id"
                              >
                                Edit
                              </app-button>
                            </div>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          }

          @if (tab() === 'media') {
            <div
              role="tabpanel"
              id="product-editor-panel-media"
              aria-labelledby="product-editor-media"
              class="flex flex-col gap-5"
              data-testid="product-editor-media"
            >
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <p class="text-xs tracking-widest uppercase text-ink-muted">
                  Browse the asset library to attach existing media, or drop new files below to
                  upload + attach in one step.
                </p>
                <app-button
                  type="button"
                  variant="secondary"
                  size="sm"
                  [disabled]="!product() || mediaBusy()"
                  (clicked)="openMediaPicker()"
                  testId="product-media-pick"
                >
                  Pick from library
                </app-button>
              </div>

              <app-dropzone
                [busy]="mediaBusy()"
                [disabled]="!product()"
                (filesAdded)="onFilesAdded($event)"
                (filesRejected)="onFilesRejected($event)"
                testId="product-media-dropzone"
              />

              @if (mediaError()) {
                <p
                  class="border border-status-error text-ink p-3 tabular text-xs"
                  role="alert"
                  data-testid="product-media-error"
                >
                  {{ mediaError() }}
                </p>
              }

              @if (assetRows().length === 0) {
                <p class="tabular text-sm text-ink-muted py-6 text-center border border-line">
                  No media yet — drop files above to get started.
                </p>
              } @else {
                <ul
                  class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                  role="list"
                  aria-label="Attached media"
                >
                  @for (row of assetRows(); track row.assetId; let i = $index) {
                    <li
                      class="border p-3 flex flex-col gap-2"
                      [class.border-line]="!row.isPrimary"
                      [class.border-ink]="row.isPrimary"
                      [attr.data-testid]="'product-media-row-' + row.assetId"
                    >
                      @if (row.asset && row.asset.type === 'IMAGE' && tileSrc(row.asset); as src) {
                        <img
                          [src]="src"
                          [alt]="resolveAssetAlt(row.asset.alt)"
                          class="block w-full aspect-square object-cover bg-surface"
                          loading="lazy"
                          decoding="async"
                          [attr.data-testid]="'product-media-thumb-' + row.assetId"
                        />
                      } @else if (row.asset && row.asset.type === 'IMAGE') {
                        <p
                          class="aspect-square flex items-center justify-center bg-surface border border-line tabular text-xs uppercase tracking-widest text-ink-muted"
                          [attr.data-testid]="'product-media-thumb-' + row.assetId"
                          [attr.aria-label]="'Status: ' + (row.asset.status ?? 'IMAGE')"
                        >
                          {{ row.asset.status ?? 'IMAGE' }}
                        </p>
                      } @else if (row.asset) {
                        <p
                          class="aspect-square flex items-center justify-center bg-surface border border-line tabular text-xs uppercase tracking-widest text-ink-muted"
                          [attr.data-testid]="'product-media-thumb-' + row.assetId"
                        >
                          {{ row.asset.type }}
                        </p>
                      }
                      <p class="tabular text-xs text-ink-muted truncate" [attr.title]="row.assetId">
                        {{ row.assetId }}
                      </p>
                      <p class="tabular text-xs text-ink-muted">
                        Sort order {{ row.sortOrder }}{{ row.isPrimary ? ' · Primary' : '' }}
                      </p>
                      <div class="flex items-center justify-between gap-2 mt-auto">
                        <div class="flex items-center gap-1">
                          <button
                            type="button"
                            class="text-xs tracking-widest uppercase min-h-11 min-w-11 px-3 py-2 border border-line hover:border-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                            [disabled]="i === 0 || mediaBusy()"
                            (click)="moveAsset(i, -1)"
                            [attr.aria-label]="'Move ' + row.assetId + ' up'"
                            [attr.data-testid]="'product-media-up-' + row.assetId"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            class="text-xs tracking-widest uppercase min-h-11 min-w-11 px-3 py-2 border border-line hover:border-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                            [disabled]="i === assetRows().length - 1 || mediaBusy()"
                            (click)="moveAsset(i, 1)"
                            [attr.aria-label]="'Move ' + row.assetId + ' down'"
                            [attr.data-testid]="'product-media-down-' + row.assetId"
                          >
                            ↓
                          </button>
                        </div>
                        <div class="flex items-center gap-1">
                          <button
                            type="button"
                            class="text-xs tracking-widest uppercase min-h-11 px-3 py-2 border border-line hover:border-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                            [disabled]="row.isPrimary || mediaBusy()"
                            (click)="setPrimaryAsset(row.assetId)"
                            [attr.aria-label]="'Set ' + row.assetId + ' as primary'"
                            [attr.data-testid]="'product-media-primary-' + row.assetId"
                          >
                            Primary
                          </button>
                          <button
                            type="button"
                            class="text-xs tracking-widest uppercase min-h-11 px-3 py-2 border border-status-error-fill bg-status-error-fill text-on-status-error-fill disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                            [disabled]="mediaBusy()"
                            (click)="removeAsset(row.assetId)"
                            [attr.aria-label]="'Remove ' + row.assetId + ' from product media'"
                            [attr.data-testid]="'product-media-remove-' + row.assetId"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  }
                </ul>
              }
            </div>
          }

          @if (tab() === 'history') {
            <div
              role="tabpanel"
              id="product-editor-panel-history"
              aria-labelledby="product-editor-history"
              class="flex flex-col gap-4"
              data-testid="product-editor-history"
            >
              @if (historyError()) {
                <p class="border border-status-error text-ink p-3 tabular text-xs" role="alert">
                  {{ historyError() }}
                </p>
              } @else if (!historyLoaded()) {
                <app-skeleton height="2rem" width="100%" />
                <app-skeleton height="2rem" width="100%" />
                <app-skeleton height="2rem" width="100%" />
              } @else if (history().length === 0) {
                <p class="tabular text-sm text-ink-muted py-8 text-center border border-line">
                  No audit entries yet.
                </p>
              } @else {
                <ul class="border border-line divide-y divide-line">
                  @for (entry of history(); track entry.id) {
                    <li class="px-4 py-3 flex flex-col gap-1">
                      <p class="tabular text-sm text-ink">
                        <span class="text-ink-muted" [title]="entry.userId ?? ''">{{
                          actorName(entry)
                        }}</span>
                        <span class="text-ink-muted mx-1" aria-hidden="true">·</span>
                        <span>{{ actionLabel(entry.action) }}</span>
                      </p>
                      <p class="tabular text-xs text-ink-muted">
                        {{ entry.createdAt | adminDate }}
                      </p>
                    </li>
                  }
                </ul>
              }
            </div>
          }

          @if (tab() === 'specs') {
            <div
              role="tabpanel"
              id="product-editor-panel-specs"
              aria-labelledby="product-editor-specs"
              class="flex flex-col gap-5"
              data-testid="product-editor-specs"
            >
              <p class="tabular text-sm text-ink-muted">
                Free-form specifications shown on the product page. The storefront can also turn a
                specification into a catalogue filter once enough products share it.
              </p>

              @if (specsError()) {
                <p
                  class="border border-status-error text-ink p-3 tabular text-xs"
                  role="alert"
                  data-testid="product-specs-error"
                >
                  {{ specsError() }}
                </p>
              }

              <app-product-specs-matrix
                [specs]="product()?.specs ?? []"
                [labelSource]="specLabelSource"
                [disabled]="specsBusy()"
                (changed)="onSpecsChanged()"
              />

              <div class="flex items-center gap-3">
                <app-button
                  type="button"
                  variant="primary"
                  size="sm"
                  [disabled]="!specsDirty() || specsBusy()"
                  [loading]="specsBusy()"
                  (clicked)="saveSpecs()"
                  testId="product-specs-save"
                >
                  {{ specsBusy() ? 'Saving…' : 'Save specifications' }}
                </app-button>
                @if (specsSaved()) {
                  <app-badge tone="success" [ariaLabel]="'Specifications saved'">Saved</app-badge>
                }
              </div>
            </div>
          }

          @if (tab() === 'seo') {
            <div
              role="tabpanel"
              id="product-editor-panel-seo"
              aria-labelledby="product-editor-seo"
              class="flex flex-col gap-5"
              data-testid="product-editor-seo"
            >
              <app-form-field label="Meta title" fieldId="product-meta-title">
                <app-translatable-input
                  formControlName="metaTitle"
                  label="Meta title"
                  inputId="product-meta-title"
                  idPrefix="product-meta-title"
                  testId="product-meta-title"
                ></app-translatable-input>
              </app-form-field>

              <app-form-field label="Meta description" fieldId="product-meta-description">
                <app-translatable-input
                  formControlName="metaDescription"
                  label="Meta description"
                  inputId="product-meta-description"
                  idPrefix="product-meta-description"
                  testId="product-meta-description"
                  [multiline]="true"
                  [rows]="3"
                ></app-translatable-input>
              </app-form-field>
            </div>
          }

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex flex-wrap items-center justify-between gap-3"
            data-testid="product-editor-footer"
          >
            <div class="flex items-center gap-3">
              <app-button
                type="button"
                variant="secondary"
                size="sm"
                [disabled]="busy()"
                (clicked)="togglePublish()"
                data-testid="product-publish-toggle"
              >
                {{ currentStatus() === 'ACTIVE' ? 'Unpublish' : 'Publish' }}
              </app-button>
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
                [routerLink]="['/products', p.id]"
                data-testid="product-editor-cancel"
              >
                Cancel
              </app-button>
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || (!form.dirty && !categoriesDirty())"
                [loading]="busy() && action() === 'save'"
                data-testid="product-editor-save"
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
export class ProductEditPage implements OnInit, OnDestroy {
  protected readonly pluralize = pluralize;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly productsService = inject(ProductsService);
  private readonly auditLogService = inject(AuditLogService);
  private readonly assetsService = inject(AssetsService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly product = signal<Product | null>(null);
  readonly busy = signal(false);
  readonly action = signal<'save' | 'publish' | null>(null);
  readonly saved = signal(false);
  readonly tab = signal<EditorTab>('general');
  readonly history = signal<readonly AuditLogEntry[]>([]);
  readonly historyLoaded = signal(false);
  readonly historyError = signal<string | null>(null);

  /** Categories flattened from the tree for the General-tab picker. */
  /**
   * The matrix owns its own FormArray, so the save reads the payload from it
   * rather than mirroring every keystroke into this page's state.
   */
  readonly specsMatrix = viewChild(ProductSpecsMatrixComponent);
  /**
   * Product-scoped stock, fetched only when the operator may see it. A caller
   * without `inventory:view` gets a 403 from the endpoint, so the page does not
   * ask rather than rendering a half-broken column.
   */
  readonly productStock = signal<ProductStock | null>(null);
  readonly canViewStock = computed(() => this.authStore.hasPermission('inventory:view'));
  readonly canUpdateStock = computed(() => this.authStore.hasPermission('inventory:update'));
  readonly stockError = signal<string | null>(null);

  readonly specsBusy = signal(false);
  readonly specsError = signal<string | null>(null);
  readonly specsDirty = signal(false);
  readonly specsSaved = signal(false);
  /** Cross-catalogue label corpus for the matrix's combobox. */
  readonly specLabelSource = createSpecLabelSource(
    this.productsService,
    () => this.authStore.locale(),
    () => this.storeSettings.defaultLocale(),
  );

  readonly selectedCategoryIds = signal<ReadonlySet<string>>(new Set());
  /** Array view of the selection, for the picker input. */
  readonly selectedCategoryList = computed(() => [...this.selectedCategoryIds()]);
  readonly categoriesDirty = signal(false);

  /** Media tab state — mirrors the product's asset rows. */
  readonly assetRows = signal<readonly ProductAssetRow[]>([]);
  readonly mediaBusy = signal(false);
  readonly mediaError = signal<string | null>(null);

  readonly tabs: readonly TabStripItem<EditorTab>[] = [
    { value: 'general', label: 'General' },
    { value: 'pricing', label: 'Pricing' },
    { value: 'variants', label: 'Variants' },
    { value: 'media', label: 'Media' },
    { value: 'specs', label: 'Specifications' },
    { value: 'seo', label: 'SEO' },
    { value: 'history', label: 'History' },
  ];

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [translatableRequired]),
    slug: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    ]),
    shortDescription: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    description: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    brand: this.fb.nonNullable.control(''),
    metaTitle: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
    metaDescription: this.fb.nonNullable.control<TranslatableValue>({ default: '' }),
  });

  readonly currentStatus = computed(() => this.product()?.status ?? 'DRAFT');
  readonly defaultVariant = computed(() => {
    const variants = this.product()?.variants ?? [];
    if (variants.length === 0) return null;
    return variants.find((v) => v.isDefault) ?? variants[0];
  });

  readonly canEdit = computed(() => this.authStore.hasPermission('products:update'));

  protected readonly pickTranslatable = (value: unknown): string =>
    pickTranslatable(value, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly actorName = actorName;
  protected readonly actionLabel = actionLabel;
  protected readonly statusTone = productStatusTone;

  /**
   * Resolves the alt-text union (Translatable | string | null) into a
   * single string the <img alt=""> attribute can render. Falls back to
   * empty string for decorative-by-default behavior when alt is null.
   */
  protected resolveAssetAlt(alt: Translatable | string | null | undefined): string {
    if (alt === null || alt === undefined) return '';
    if (typeof alt === 'string') return alt;
    return pickTranslatable(alt, this.authStore.locale(), this.storeSettings.defaultLocale());
  }

  /**
   * AV3 — Media-tab tile thumbnail URL via the resolver shim. Returns null
   * when the row's `asset` envelope lacks a usable `variants` payload (e.g.
   * a fresh upload still PROCESSING, or a legacy GET response served before
   * AV3.18 widened the backend select). The template falls back to a status
   * placeholder block in those cases.
   */
  protected tileSrc(asset: NonNullable<ProductAssetRow['asset']>): string | null {
    return (
      this.assetsService.tryPublicVariantUrl(
        { id: asset.id, status: asset.status ?? 'READY', variants: asset.variants },
        'thumbnail',
      )?.url ?? null
    );
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.error.set('Missing product id.');
        this.loading.set(false);
        return;
      }
      this.fetch(id);
    });
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((qp) => {
      const requested = qp.get('tab');
      if (requested && this.isEditorTab(requested)) {
        this.setTab(requested);
      }
    });
  }

  private isEditorTab(value: string): value is EditorTab {
    return (
      value === 'general' ||
      value === 'pricing' ||
      value === 'variants' ||
      value === 'media' ||
      value === 'specs' ||
      value === 'seo' ||
      value === 'history'
    );
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setTab(tab: EditorTab): void {
    this.tab.set(tab);
    if (tab === 'history' && !this.historyLoaded()) {
      this.loadHistory();
    }
  }

  openVariantDialog(variant: Variant | null): void {
    const product = this.product();
    if (!product) return;
    const ref = this.dialog.open<VariantDialogResult, VariantDialogData>(VariantDialogComponent, {
      data: { productId: product.id, variant },
      role: 'dialog',
      ariaModal: true,
      ariaLabel: variant ? 'Edit variant' : 'New variant',
      hasBackdrop: true,
      disableClose: false,
      panelClass: 'side-panel-right',
      backdropClass: 'cdk-overlay-backdrop-brand',
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      if (result.kind === 'saved') {
        this.applyVariantSave(result.variant);
      } else if (result.kind === 'deleted') {
        this.applyVariantDelete(result.variantId);
      }
    });
  }

  private applyVariantSave(saved: Variant): void {
    const current = this.product();
    if (!current) return;
    const variants = [...(current.variants ?? [])];
    const idx = variants.findIndex((v) => v.id === saved.id);
    if (idx === -1) {
      variants.push(saved);
    } else {
      variants[idx] = saved;
    }
    // If the saved variant is marked default, clear isDefault on others so
    // the UI reflects the backend invariant (exactly one default active).
    const next = saved.isDefault
      ? variants.map((v) => (v.id === saved.id ? v : { ...v, isDefault: false }))
      : variants;
    this.product.set({ ...current, variants: next });
  }

  private applyVariantDelete(variantId: string): void {
    const current = this.product();
    if (!current) return;
    this.product.set({
      ...current,
      variants: (current.variants ?? []).filter((v) => v.id !== variantId),
    });
  }

  private loadHistory(): void {
    const product = this.product();
    if (!product) return;
    this.historyError.set(null);
    this.auditLogService
      .listByEntity('product', product.id, { pageSize: 20 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.history.set(res.data);
          this.historyLoaded.set(true);
        },
        error: (err: unknown) => {
          this.historyLoaded.set(true);
          if (err instanceof ApiForbiddenError) {
            this.historyError.set('You do not have permission to view the audit log.');
          } else {
            this.historyError.set('Could not load history.');
          }
        },
      });
  }

  // ── Categories ─────────────────────────────────────────────────────────

  /**
   * The picker owns the tree fetch and its own degraded state, so this page
   * only records the selection. It emits nothing when it could not read the
   * tree, which is what stops a save from a degraded picker replacing the
   * product's real categories with an empty list.
   */
  onCategorySelectionChange(ids: readonly string[]): void {
    this.selectedCategoryIds.set(new Set(ids));
    this.categoriesDirty.set(true);
  }

  // ── Stock ──────────────────────────────────────────────────────────────

  stockFor(variantId: string): ProductStockVariant | null {
    return this.productStock()?.variants.find((v) => v.variantId === variantId) ?? null;
  }

  private loadStock(): void {
    const id = this.product()?.id;
    if (!id || !this.canViewStock()) return;
    this.productsService
      .getProductStock(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stock) => {
          this.productStock.set(stock);
          this.stockError.set(null);
        },
        error: (err: unknown) => {
          // Stock is supplementary here, so a failure must not take the editor
          // down with it. It must still be VISIBLE though: a bare dash in the
          // column is indistinguishable from "this variant has no stock", which
          // is the silent-swallow shape the recurrence guard exists to catch.
          this.productStock.set(null);
          this.stockError.set(
            err instanceof ApiForbiddenError
              ? 'You do not have permission to view stock.'
              : 'Could not load stock for this product.',
          );
        },
      });
  }

  async openStock(variant: Variant): Promise<void> {
    const id = this.product()?.id;
    if (!id) return;
    const saved = await openStockPanel(this.dialog, {
      productId: id,
      variantId: variant.id,
      sku: variant.sku,
    });
    if (saved) this.loadStock();
  }

  // ── Specifications ─────────────────────────────────────────────────────

  onSpecsChanged(): void {
    this.specsDirty.set(true);
    this.specsSaved.set(false);
  }

  /**
   * Replace the whole set in one call.
   *
   * Deliberately NOT folded into the General tab's PATCH: this is a separate
   * endpoint with its own failure modes, and one Save button firing two calls
   * gives the operator no way to know which half failed. It also means saving
   * General can never touch specifications.
   */
  saveSpecs(): void {
    const id = this.product()?.id;
    const matrix = this.specsMatrix();
    if (!id || !matrix || this.specsBusy()) return;

    if (matrix.hasIncompleteRow()) {
      this.specsError.set('Every specification needs a label and a value.');
      return;
    }

    const specs = matrix.toSpecs();
    this.specsBusy.set(true);
    this.specsError.set(null);

    // The request schema parses synchronously, so an over-cap array throws from
    // the call itself rather than reaching the error channel.
    try {
      this.productsService
        .replaceSpecs(id, { specs })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (rows) => {
            this.product.update((p) => (p ? { ...p, specs: rows } : p));
            this.specsBusy.set(false);
            this.specsDirty.set(false);
            this.specsSaved.set(true);
          },
          error: (err: unknown) => {
            this.specsBusy.set(false);
            this.specsError.set(this.formatSpecsError(err));
          },
        });
    } catch {
      this.specsBusy.set(false);
      this.specsError.set('Those specifications could not be sent. Check the rows and retry.');
    }
  }

  /**
   * The server rejects a folded-key collision and an empty folded key with
   * coded 400s. Surface those specifically: "Could not save" would leave the
   * operator staring at two rows that look different to them.
   */
  private formatSpecsError(err: unknown): string {
    const code = err instanceof ApiError ? (err.code ?? null) : null;
    if (code === 'PRODUCT_SPEC_DUPLICATE_KEY') {
      return 'Two rows are the same specification once accents and punctuation are ignored. Rename one.';
    }
    if (code === 'PRODUCT_SPEC_EMPTY_KEY') {
      return 'A specification label needs at least one letter or digit.';
    }
    if (err instanceof ApiForbiddenError) {
      return 'You do not have permission to change specifications.';
    }
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save specifications. Please retry.';
  }

  // ── Media ──────────────────────────────────────────────────────────────

  onFilesAdded(files: File[]): void {
    if (!files.length || this.mediaBusy()) return;
    const product = this.product();
    if (!product) return;
    this.mediaBusy.set(true);
    this.mediaError.set(null);
    const nextSortOrder = this.assetRows().length;
    const makePrimary = this.assetRows().length === 0;

    const uploads = files.map((file) =>
      this.assetsService.upload(file).pipe(
        // Chain each upload's resulting asset into a row.
        takeUntil(this.destroy$),
      ),
    );

    let pending = uploads.length;
    const created: Asset[] = [];
    let failed = false;
    uploads.forEach((upload$) => {
      upload$.subscribe({
        next: (asset) => {
          created.push(asset);
        },
        error: (err: unknown) => {
          failed = true;
          if (!this.mediaError()) {
            this.mediaError.set(this.formatMediaError(err, 'Upload failed.'));
          }
        },
        complete: () => {
          pending -= 1;
          if (pending === 0) this.afterUploads(created, nextSortOrder, makePrimary, failed);
        },
      });
    });
  }

  /**
   * S18.8 — opens the asset-picker (multi-select). New rows are appended
   * to the existing media list with continuing sortOrder; previously
   * attached assets are skipped (selectedIds passed to the picker so the
   * dialog reflects the current state). The picker emits `Asset` records;
   * each is mapped into a `ProductAssetRow` with the same envelope shape
   * the API returns on GET so the template can render thumbnails without
   * a refetch round-trip.
   */
  async openMediaPicker(): Promise<void> {
    const product = this.product();
    if (!product || this.mediaBusy()) return;
    const selectedIds = this.assetRows().map((r) => r.assetId);
    const result = await openAssetPicker(this.dialog, {
      mode: 'multi',
      title: 'Pick product media',
      filter: { type: 'IMAGE' },
      selectedIds,
    });
    if (result.kind !== 'select-multi') return;
    const rows = this.assetRows();
    const existingIds = new Set(rows.map((r) => r.assetId));
    const additions: ProductAssetRow[] = result.assets
      .filter((a) => !existingIds.has(a.id))
      .map((a, idx) => ({
        assetId: a.id,
        sortOrder: rows.length + idx,
        isPrimary: rows.length === 0 && idx === 0,
        asset: {
          id: a.id,
          url: a.url,
          type: a.type,
          alt: a.alt ?? null,
          status: a.status,
          variants: a.variants,
        },
      }));
    if (additions.length === 0) return;
    this.persistAssets([...rows, ...additions]);
  }

  onFilesRejected(rejections: DropzoneFileRejection[]): void {
    if (rejections.length === 0) return;
    const names = rejections.map((r) => r.file.name).join(', ');
    const reason =
      rejections[0].reason === 'size' ? 'File is larger than 10 MB' : 'File type not allowed';
    this.mediaError.set(`${reason}: ${names}`);
  }

  moveAsset(index: number, delta: number): void {
    const rows = [...this.assetRows()];
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    const renumbered = rows.map((r, i) => ({ ...r, sortOrder: i }));
    this.persistAssets(renumbered);
  }

  setPrimaryAsset(assetId: string): void {
    const rows = this.assetRows().map((r) => ({
      ...r,
      isPrimary: r.assetId === assetId,
    }));
    this.persistAssets(rows);
  }

  removeAsset(assetId: string): void {
    const remaining = this.assetRows().filter((r) => r.assetId !== assetId);
    if (remaining.length === 0) {
      // Backend enforces at least one asset — surface the constraint locally
      // rather than sending an empty array that will 400.
      this.mediaError.set(
        'Keep at least one asset. Upload a replacement before removing this one.',
      );
      return;
    }
    // Renumber + ensure exactly one primary survives.
    if (!remaining.some((r) => r.isPrimary)) remaining[0] = { ...remaining[0], isPrimary: true };
    const renumbered = remaining.map((r, i) => ({ ...r, sortOrder: i }));
    this.persistAssets(renumbered);
  }

  private afterUploads(
    created: Asset[],
    startSortOrder: number,
    makePrimaryFirst: boolean,
    hadFailure: boolean,
  ): void {
    this.mediaBusy.set(false);
    if (created.length === 0) return;
    const appended: ProductAssetRow[] = created.map((asset, i) => ({
      assetId: asset.id,
      sortOrder: startSortOrder + i,
      isPrimary: makePrimaryFirst && i === 0,
      asset: {
        id: asset.id,
        url: asset.url,
        type: asset.type,
        alt: asset.alt ?? null,
        status: asset.status,
        variants: asset.variants,
      },
    }));
    const next = [...this.assetRows(), ...appended];
    // Guarantee invariant: exactly one isPrimary.
    if (!next.some((r) => r.isPrimary)) next[0] = { ...next[0], isPrimary: true };
    this.persistAssets(next, hadFailure);
  }

  private persistAssets(rows: ProductAssetRow[], keepExistingError = false): void {
    const product = this.product();
    if (!product) return;
    const wireRows = rows.map((r) => ({
      assetId: r.assetId,
      sortOrder: r.sortOrder,
      isPrimary: r.isPrimary,
    }));
    const body = {
      assets: wireRows as [(typeof wireRows)[number], ...(typeof wireRows)[number][]],
    };
    this.mediaBusy.set(true);
    if (!keepExistingError) this.mediaError.set(null);
    this.productsService.updateProductAssets(product.id, body).subscribe({
      next: () => {
        this.mediaBusy.set(false);
        this.assetRows.set(rows);
      },
      error: (err: unknown) => {
        this.mediaBusy.set(false);
        this.mediaError.set(this.formatMediaError(err, 'Could not save media changes.'));
      },
    });
  }

  private formatMediaError(err: unknown, fallback: string): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to change media.';
    if (err instanceof ApiNotFoundError) return 'Asset not found.';
    if (err instanceof ApiError) {
      if (err.status === 413) return 'File is larger than the server limit.';
      if (err.status === 415) return 'File type rejected by the server.';
      if (err.message) return err.message;
    }
    return fallback;
  }

  slugError(): string | null {
    const c = this.form.controls.slug;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Slug is required.';
    if (c.hasError('pattern'))
      return 'Lowercase letters, digits, and hyphens only — no spaces or symbols.';
    return null;
  }

  save(): void {
    this.form.markAllAsTouched();
    const hasChanges = this.form.dirty || this.categoriesDirty();
    if (this.form.invalid || !hasChanges || this.busy()) return;

    const id = this.product()?.id;
    if (!id) return;

    const body: UpdateProductRequest = this.buildPatchBody();
    this.startAction('save');
    this.productsService.updateProduct(id, body).subscribe({
      next: (updated) => {
        this.product.set(updated);
        this.seedSelectedCategories(updated);
        this.categoriesDirty.set(false);
        this.form.markAsPristine();
        this.finishAction();
      },
      error: (err: unknown) => this.failAction(err, 'Could not save product.'),
    });
  }

  async togglePublish(): Promise<void> {
    if (!this.product() || this.busy()) return;
    const going = this.currentStatus() === 'ACTIVE' ? 'DRAFT' : 'ACTIVE';

    if (going === 'ACTIVE') {
      const ok = await openConfirmDialog(this.dialog, {
        title: 'Publish this product?',
        body: 'Publishing makes the product visible on the storefront and searchable immediately.',
        confirmLabel: 'Publish',
        tone: 'neutral',
      });
      if (!ok) return;
    }

    const id = this.product()!.id;
    this.startAction('publish');
    this.productsService.updateProduct(id, { status: going }).subscribe({
      next: (updated) => {
        this.product.set(updated);
        this.finishAction();
      },
      error: (err: unknown) =>
        this.failAction(err, going === 'ACTIVE' ? 'Publish failed.' : 'Unpublish failed.'),
    });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.productsService
      .getProduct(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (product) => {
          this.product.set(product);
          this.seedForm(product);
          this.loading.set(false);
          this.loadStock();
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private seedForm(product: Product): void {
    const asTranslatable = (v: unknown): TranslatableValue => {
      if (v && typeof v === 'object' && 'default' in (v as object)) {
        return v as TranslatableValue;
      }
      return typeof v === 'string' ? { default: v } : { default: '' };
    };
    this.form.reset(
      {
        name: asTranslatable(product.name),
        slug: product.slug,
        shortDescription: asTranslatable(product.shortDescription),
        description: asTranslatable(product.description),
        brand: product.brand ?? '',
        metaTitle: asTranslatable(product.metaTitle),
        metaDescription: asTranslatable(product.metaDescription),
      },
      { emitEvent: false },
    );
    this.seedAssetRows(product);
    this.seedSelectedCategories(product);
  }

  private seedAssetRows(product: Product): void {
    const raw = product.assets ?? [];
    const rows: ProductAssetRow[] = raw.map((r, idx) => ({
      assetId: r.assetId,
      sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : idx,
      isPrimary: !!r.isPrimary,
      // `asset` is present on the detail response but absent on the list
      // response. Guard so list-context seeds don't crash; detail context
      // always provides it. AV3 — propagate `status` + `variants` so the
      // tile resolver can render variant URLs once AV3.18 widens the
      // backend select; legacy responses without those fields fall back to
      // the type/status placeholder block.
      asset: r.asset
        ? {
            id: r.asset.id,
            url: r.asset.url,
            type: r.asset.type,
            alt: r.asset.alt ?? null,
            status: (r.asset as { status?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' }).status,
            variants: (r.asset as { variants?: unknown }).variants,
          }
        : undefined,
    }));
    rows.sort((a, b) => a.sortOrder - b.sortOrder);
    this.assetRows.set(rows);
  }

  /**
   * Pre-check the boxes for the categories the product already has.
   *
   * Reads the typed field rather than an `as unknown as` cast: the cast is what
   * hid the fact that `productSchema` did not declare `categories`, so the zod
   * parse stripped it, this seeded an empty set, and the first toggle-then-save
   * detached every category the product had.
   */
  private seedSelectedCategories(product: Product): void {
    const ids = new Set<string>();
    for (const row of product.categories ?? []) {
      if (row.categoryId) ids.add(row.categoryId);
    }
    this.selectedCategoryIds.set(ids);
  }

  /**
   * Ship only the dirty fields so unchanged Translatable objects don't
   * trigger spurious audit-log rows. Slug + brand empty-string is still
   * a deliberate clear if the control is dirty.
   */
  private buildPatchBody(): UpdateProductRequest {
    const body: UpdateProductRequest = {};
    const c = this.form.controls;
    if (c.name.dirty) body.name = c.name.value;
    if (c.slug.dirty) body.slug = c.slug.value;
    if (c.shortDescription.dirty) body.shortDescription = c.shortDescription.value;
    if (c.description.dirty) body.description = c.description.value;
    if (c.brand.dirty) body.brand = c.brand.value;
    if (c.metaTitle.dirty) body.metaTitle = c.metaTitle.value;
    if (c.metaDescription.dirty) body.metaDescription = c.metaDescription.value;
    if (this.categoriesDirty()) {
      body.categoryIds = Array.from(this.selectedCategoryIds());
    }
    return body;
  }

  private startAction(kind: 'save' | 'publish'): void {
    this.busy.set(true);
    this.action.set(kind);
    this.error.set(null);
    this.saved.set(false);
  }

  private finishAction(): void {
    this.busy.set(false);
    this.action.set(null);
    this.saved.set(true);
    // Auto-clear the saved banner after a short beat so a subsequent error
    // doesn't appear alongside a stale "Saved" tag.
    setTimeout(() => this.saved.set(false), 3000);
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.saved.set(false);
    this.error.set(this.formatError(err, fallback));
  }

  private formatError(err: unknown, fallback = 'Could not load product.'): string {
    if (err instanceof ApiNotFoundError) return 'Product not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to edit this product.';
    if (err instanceof ApiConflictError) return 'Slug conflict — pick a different slug.';
    if (err instanceof ApiError && err.message) return err.message;
    return fallback;
  }
}
