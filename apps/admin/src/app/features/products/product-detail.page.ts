import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TextareaComponent,
  openConfirmDialog,
} from '@admin-ui';
import {
  AssetsService,
  GeoService,
  ProductsService,
  type FaqItem,
  type Product,
  type ProductStock,
  type ProductStockVariant,
  type ProductFaqRef,
} from '@admin-services';
import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import {
  looksLikeRichTextHtml,
  pickTranslatable,
  productStatusTone,
  qualityTone,
} from './products.utils';
import { SeoIndexStateBadgeComponent } from './seo-index-state-badge.component';
import { StorefrontLinkComponent } from '../../shared/components/storefront-link.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import type { Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

/**
 * `/products/:id` — read-only product detail. Deep edits (variants,
 * assets, locale tabs, rich-text description) are done on `/products/:id/edit`.
 */
@Component({
  selector: 'app-product-detail-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TextareaComponent,
    SeoIndexStateBadgeComponent,
    StorefrontLinkComponent,
    MoneyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="p-6 md:p-10 flex flex-col gap-8"
      data-testid="product-detail-page"
      [attr.aria-busy]="loading() ? 'true' : null"
    >
      <p class="sr-only" role="status" aria-live="polite" data-testid="product-restore-status">
        {{ restoreAnnouncement() ?? '' }}
      </p>
      <p class="sr-only" role="status" aria-live="polite" data-testid="product-faq-status">
        {{ faqAnnouncement() ?? '' }}
      </p>
      <p class="sr-only" role="status" aria-live="polite" data-testid="product-geo-status">
        {{ geoAnnouncement() ?? '' }}
      </p>

      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/products"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Products
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">
          {{ product() ? pickTranslatable(product()!.name) : '…' }}
        </span>
      </nav>

      @if (error()) {
        <p
          class="border border-status-error text-ink p-3 tabular text-xs"
          data-testid="product-error"
          role="alert"
        >
          {{ error() }}
        </p>
      }

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="2.5rem" width="40%" />
          <app-skeleton height="1rem" width="60%" />
          <app-skeleton height="12rem" width="100%" />
        </div>
      } @else if (product(); as p) {
        <header class="flex flex-wrap items-end justify-between gap-6">
          <div class="flex-1 min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">Product</p>
            <h1
              #headingEl
              tabindex="-1"
              class="mt-2 text-4xl md:text-5xl font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              {{ pickTranslatable(p.name) }}
            </h1>
            <p class="mt-3 tabular text-sm text-ink-muted">/{{ p.slug }}</p>
            <app-storefront-link
              class="mt-2 block"
              [slug]="p.slug"
              [status]="p.status"
              [productName]="pickTranslatable(p.name)"
            />
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <app-badge [tone]="statusTone(p.status)" [ariaLabel]="'Product status: ' + p.status">
              {{ p.status }}
            </app-badge>
            @if (p.qualityScore) {
              <app-badge
                [tone]="qualityTone(p.qualityScore.grade)"
                [attr.title]="'Product content quality score (0–100)'"
                [ariaLabel]="
                  'Quality score: ' +
                  p.qualityScore.score +
                  ' out of 100, grade ' +
                  p.qualityScore.grade
                "
              >
                Quality · {{ p.qualityScore.score }}
              </app-badge>
            }
            @if (canEdit()) {
              <app-button
                variant="primary"
                size="sm"
                [routerLink]="['/products', p.id, 'edit']"
                data-testid="product-edit-link"
              >
                Edit
              </app-button>
            }
            @if (canRestore()) {
              <app-button
                variant="primary"
                size="sm"
                data-testid="product-restore-button"
                [ariaLabel]="'Restore ' + pickTranslatable(p.name)"
                [loading]="restoring()"
                (clicked)="onRestoreClick()"
              >
                {{ restoring() ? 'Restoring…' : 'Restore' }}
              </app-button>
            }
          </div>
        </header>

        <h2 id="product-meta-heading" class="sr-only">Product metadata</h2>
        <dl
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          aria-labelledby="product-meta-heading"
        >
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Brand</dt>
            <dd class="mt-2 tabular text-sm">{{ p.brand ?? '—' }}</dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Product type</dt>
            <dd class="mt-2 tabular text-sm" [title]="p.productTypeId ?? ''">
              {{ p.productType ? pickTranslatable(p.productType.name) : (p.productTypeId ?? '—') }}
            </dd>
          </div>
          <div class="border border-line bg-surface p-5">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">Variants</dt>
            <dd class="mt-2 text-2xl font-bold tabular-nums">
              {{ p.variants?.length ?? 0 }}
            </dd>
          </div>
        </dl>

        <section
          class="border border-line bg-surface"
          aria-labelledby="product-categories-heading"
          data-testid="product-categories"
        >
          <header class="px-5 py-4 border-b border-line flex items-center justify-between gap-4">
            <h2
              id="product-categories-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Categories
            </h2>
            @if (canEdit()) {
              <a
                [routerLink]="['/products', p.id, 'edit']"
                class="text-xs tabular text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                data-testid="product-categories-edit"
              >
                Edit
              </a>
            }
          </header>
          @if (categoryNames().length === 0) {
            <p
              class="px-5 py-4 tabular text-sm text-ink-muted"
              data-testid="product-categories-empty"
            >
              No categories.
            </p>
          } @else {
            <ul class="px-5 py-4 flex flex-wrap gap-2" role="list">
              @for (c of categoryNames(); track c.id) {
                <li
                  class="border border-line px-3 py-1 tabular text-sm text-ink"
                  [attr.data-testid]="'product-category-chip-' + c.id"
                >
                  {{ c.label }}
                </li>
              }
            </ul>
          }
        </section>

        <section
          class="border border-line bg-surface"
          aria-labelledby="product-specs-heading"
          data-testid="product-spec-panel"
        >
          <header class="px-5 py-4 border-b border-line flex items-center justify-between gap-4">
            <h2 id="product-specs-heading" class="text-xs tracking-widest uppercase text-ink-muted">
              Specifications
            </h2>
            @if (canEdit()) {
              <a
                [routerLink]="['/products', p.id, 'edit']"
                [queryParams]="{ tab: 'specs' }"
                class="text-xs tabular text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                data-testid="product-specs-edit"
              >
                Edit
              </a>
            }
          </header>
          @if (specRows().length === 0) {
            <p class="px-5 py-4 tabular text-sm text-ink-muted" data-testid="product-spec-empty">
              No specifications yet.
            </p>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full border-collapse">
                <caption class="sr-only">
                  Product specifications
                </caption>
                <thead class="border-b border-line">
                  <tr class="text-start">
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-5 py-3 text-start"
                    >
                      Specification
                    </th>
                    <th
                      scope="col"
                      class="text-xs tracking-widest uppercase text-ink-muted font-normal px-5 py-3 text-start"
                    >
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of specRows(); track row.id) {
                    <tr
                      class="border-b border-line last:border-b-0"
                      [attr.data-testid]="'product-spec-' + row.id"
                    >
                      <td class="px-5 py-3 tabular text-sm text-ink-muted">{{ row.label }}</td>
                      <td class="px-5 py-3 tabular text-sm text-ink">{{ row.value }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        @if ((p.assets?.length ?? 0) > 0) {
          <section
            class="border border-line bg-surface"
            aria-labelledby="product-media-heading"
            data-testid="product-media-strip"
          >
            <header class="px-5 py-4 border-b border-line flex items-center justify-between gap-4">
              <h2
                id="product-media-heading"
                class="text-xs tracking-widest uppercase text-ink-muted"
              >
                Media
              </h2>
              @if (canEdit()) {
                <a
                  [routerLink]="['/products', p.id, 'edit']"
                  [queryParams]="{ tab: 'media' }"
                  class="inline-flex items-center min-h-11 px-2 py-2 text-xs tracking-widest uppercase text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                  data-testid="product-media-strip-edit-link"
                >
                  Manage
                </a>
              }
            </header>
            <ul
              class="px-5 py-5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3"
              role="list"
              aria-label="Product media"
            >
              @for (row of p.assets; track row.assetId; let i = $index) {
                @if (row.asset) {
                  <li
                    class="border p-1"
                    [class.border-line]="!row.isPrimary"
                    [class.border-ink]="row.isPrimary"
                    [attr.data-testid]="'product-media-strip-thumb-' + row.assetId"
                  >
                    @if (canEdit()) {
                      <a
                        [routerLink]="['/products', p.id, 'edit']"
                        [queryParams]="{ tab: 'media' }"
                        class="block focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                        [attr.aria-label]="thumbAriaLabel(row, i, p.assets!.length)"
                        [attr.data-testid]="'product-media-strip-thumb-link-' + row.assetId"
                      >
                        @if (row.asset.type === 'IMAGE' && stripSrc(row.asset); as src) {
                          <img
                            [src]="src"
                            [alt]="resolveAssetAlt(row.asset.alt)"
                            class="block w-full aspect-square object-cover bg-surface"
                            loading="lazy"
                            decoding="async"
                          />
                        } @else {
                          <p
                            class="aspect-square flex items-center justify-center bg-surface tabular text-xs uppercase tracking-widest text-ink-muted"
                            [attr.aria-label]="'Type: ' + row.asset.type"
                          >
                            {{ row.asset.type }}
                          </p>
                        }
                      </a>
                    } @else {
                      @if (row.asset.type === 'IMAGE' && stripSrc(row.asset); as src) {
                        <img
                          [src]="src"
                          [alt]="resolveAssetAlt(row.asset.alt)"
                          class="block w-full aspect-square object-cover bg-surface"
                          loading="lazy"
                          decoding="async"
                        />
                      } @else {
                        <p
                          class="aspect-square flex items-center justify-center bg-surface tabular text-xs uppercase tracking-widest text-ink-muted"
                          [attr.aria-label]="'Type: ' + row.asset.type"
                        >
                          {{ row.asset.type }}
                        </p>
                      }
                    }
                  </li>
                }
              }
            </ul>
          </section>
        }

        @if (p.description) {
          <section
            class="border border-line bg-surface"
            aria-labelledby="product-description-heading"
          >
            <header class="px-5 py-4 border-b border-line">
              <h2
                id="product-description-heading"
                class="text-xs tracking-widest uppercase text-ink-muted"
              >
                Description
              </h2>
            </header>
            <!--
              Authored with TranslatableRichTextComponent, so the value is HTML.
              Interpolating it showed the operator raw <p> and <li> tags in the
              read view. Rendered through Angular's default [innerHTML]
              sanitiser; the value is already scrubbed on write by
              products.service.ts against the same allowlist the editor uses.
              A DIV, not a P, because the allowlist admits <p>, <ul> and <h2>,
              none of which may legally sit inside a <p>.

              The plain branch is not a leftover. The seeded catalogue predates
              the editor and stores 
 paragraph breaks, which HTML rendering
              swallows, so the operator would read one dense blob instead.
            -->
            @if (descriptionIsRich(p)) {
              <!-- innerhtml-approved: admin-authored rich text, sanitized on write by sanitizeRichTextHtml against a safe-tag allowlist (constitution 3.5); Angular sanitizes again on render. No bypassSecurityTrust* involved. -->
              <div
                class="px-5 py-4 text-sm text-ink [&_a]:underline [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:font-medium [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:font-medium [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-medium [&_li]:mb-1 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ps-5"
                data-testid="product-description-body"
                [innerHTML]="pickTranslatable(p.description)"
              ></div>
            } @else {
              <p
                class="px-5 py-4 text-sm text-ink whitespace-pre-line"
                data-testid="product-description-body"
              >
                {{ pickTranslatable(p.description) }}
              </p>
            }
          </section>
        }

        <section
          class="border border-line bg-surface"
          aria-labelledby="product-variants-heading"
          data-testid="product-variants"
        >
          <header class="px-5 py-4 border-b border-line">
            <h2
              id="product-variants-heading"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              Variants
            </h2>
          </header>
          @if (!p.variants?.length) {
            <p class="px-5 py-10 text-center tabular text-sm text-ink-muted">No variants yet.</p>
          } @else {
            <div class="overflow-x-auto">
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
                      Weight
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
                  </tr>
                </thead>
                <tbody>
                  @for (variant of p.variants; track variant.id) {
                    <tr class="border-b border-line last:border-b-0" data-testid="variant-row">
                      <td class="px-4 py-3 tabular text-sm text-ink" data-testid="variant-row-sku">
                        {{ variant.sku }}
                      </td>
                      <td
                        class="px-4 py-3 tabular text-sm tabular-nums"
                        data-testid="variant-row-price"
                      >
                        {{ variant.price | money }}
                      </td>
                      <td class="px-4 py-3 tabular text-sm text-ink-muted tabular-nums">
                        {{ variant.weight ?? '—' }}
                      </td>
                      <td class="px-4 py-3 tabular text-sm text-ink-muted">
                        {{ variant.isDefault ? 'Yes' : '—' }}
                      </td>
                      <td class="px-4 py-3 tabular text-sm text-ink-muted">
                        {{ variant.isActive ? 'Yes' : 'No' }}
                      </td>
                      @if (canViewStock()) {
                        <td class="px-4 py-3 tabular text-sm">
                          @if (stockFor(variant.id); as st) {
                            <span class="tabular-nums text-ink">{{ st.totals.available }}</span>
                            <span class="block text-xs tabular text-ink-muted">
                              {{ st.totals.onHand }} on hand · {{ st.totals.reserved }} reserved
                            </span>
                          } @else {
                            <span class="text-ink-muted">—</span>
                          }
                          <!--
                            The other half of the cross-link: the inventory
                            variant page has never been reachable from a
                            product, and vice versa.
                          -->
                          <a
                            [routerLink]="['/inventory/variants', variant.id]"
                            class="block mt-1 text-xs tabular text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                            [attr.data-testid]="'variant-inventory-link-' + variant.id"
                          >
                            Inventory
                          </a>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <section
          class="border border-line bg-surface"
          aria-labelledby="product-faqs-heading"
          data-testid="product-faq-panel"
          [attr.aria-busy]="faqPending() ? 'true' : null"
        >
          <header class="px-5 py-4 border-b border-line flex items-center justify-between gap-4">
            <h2 id="product-faqs-heading" class="text-xs tracking-widest uppercase text-ink-muted">
              FAQ entries
            </h2>
            @if (canCreateFaq() && editingFaq() === null) {
              <app-button
                variant="primary"
                size="sm"
                #addFaqBtn
                data-testid="product-faq-add"
                (clicked)="onAddFaqClick()"
              >
                Add FAQ
              </app-button>
            }
          </header>

          @if (faqError()) {
            <p
              class="mx-5 my-4 border border-status-error text-ink p-3 tabular text-xs"
              data-testid="product-faq-error"
              role="alert"
            >
              {{ faqError() }}
            </p>
          }

          @if (editingFaq() !== null) {
            <form
              class="px-5 py-5 flex flex-col gap-4 border-b border-line"
              [formGroup]="faqForm"
              (ngSubmit)="onSaveFaq()"
              data-testid="product-faq-form"
              novalidate
            >
              <app-form-field
                label="Question"
                [required]="true"
                fieldId="product-faq-question-field"
                [error]="questionError()"
              >
                <app-input
                  #questionInput
                  id="product-faq-question-field"
                  type="text"
                  formControlName="question"
                  data-testid="product-faq-question-input"
                  [invalid]="!!questionError()"
                />
              </app-form-field>
              <app-form-field
                label="Answer"
                [required]="true"
                fieldId="product-faq-answer-field"
                [error]="answerError()"
              >
                <app-textarea
                  id="product-faq-answer-field"
                  formControlName="answer"
                  [rows]="3"
                  data-testid="product-faq-answer-input"
                  [invalid]="!!answerError()"
                />
              </app-form-field>
              <div class="flex items-center gap-2">
                <app-button
                  variant="primary"
                  size="sm"
                  type="submit"
                  data-testid="product-faq-save"
                  [loading]="faqPending()"
                  [disabled]="faqPending() || faqForm.invalid"
                >
                  {{ faqPending() ? 'Saving…' : 'Save FAQ' }}
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  type="button"
                  data-testid="product-faq-cancel"
                  [disabled]="faqPending()"
                  (clicked)="onCancelFaqClick()"
                >
                  Cancel
                </app-button>
              </div>
            </form>
          }

          @if ((p.faqs?.length ?? 0) === 0 && editingFaq() === null) {
            <p
              class="px-5 py-10 text-center tabular text-sm text-ink-muted"
              data-testid="product-faq-empty"
            >
              No FAQ entries yet. Add one to surface in search and AI-answer flows.
            </p>
          } @else if (p.faqs?.length) {
            <ul class="divide-y divide-line">
              @for (faq of p.faqs; track faq.id) {
                <li
                  class="px-5 py-4 flex items-start justify-between gap-4"
                  [attr.data-testid]="'product-faq-card-' + faq.id"
                >
                  <div class="flex-1 min-w-0">
                    <h3 class="text-sm font-bold tracking-tight text-ink">
                      {{ pickTranslatable(faq.question) }}
                    </h3>
                    <p class="mt-2 text-sm text-ink-muted whitespace-pre-line">
                      {{ pickTranslatable(faq.answer) }}
                    </p>
                  </div>
                  <div class="flex items-start gap-2 shrink-0">
                    @if (canUpdateFaq()) {
                      <app-button
                        variant="secondary"
                        size="sm"
                        [attr.data-testid]="'product-faq-edit-' + faq.id"
                        [ariaLabel]="'Edit FAQ: ' + pickTranslatable(faq.question)"
                        [disabled]="faqPending()"
                        (clicked)="onEditFaqClick(faq)"
                      >
                        Edit
                      </app-button>
                    }
                    @if (canDeleteFaq()) {
                      <app-button
                        variant="destructive"
                        size="sm"
                        [attr.data-testid]="'product-faq-delete-' + faq.id"
                        [ariaLabel]="'Delete FAQ: ' + pickTranslatable(faq.question)"
                        [disabled]="faqPending()"
                        (clicked)="onDeleteFaqClick(faq)"
                      >
                        Delete
                      </app-button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        @if (canViewGeo()) {
          <section
            class="border border-line bg-surface"
            aria-labelledby="product-geo-heading"
            data-testid="product-geo-panel"
            [attr.aria-busy]="geoAccepting() ? 'true' : null"
          >
            <header class="px-5 py-4 border-b border-line">
              <h2 id="product-geo-heading" class="text-xs tracking-widest uppercase text-ink-muted">
                AI readiness
              </h2>
            </header>

            @if (geoError()) {
              <p
                class="mx-5 my-4 border border-status-error text-ink p-3 tabular text-xs"
                data-testid="product-geo-error"
                role="alert"
              >
                {{ geoError() }}
              </p>
            }

            @if (geoLoading()) {
              <div class="px-5 py-6 flex flex-col gap-3">
                <app-skeleton height="3rem" width="30%" />
                <app-skeleton height="1rem" width="80%" />
              </div>
            } @else {
              <div class="px-5 py-5 flex flex-col gap-5">
                @if (geoSuggestions().length) {
                  <div class="flex flex-col gap-3">
                    <h3
                      id="product-geo-suggestions-heading"
                      class="text-xs tracking-widest uppercase text-ink-muted"
                    >
                      Suggested FAQ entries
                    </h3>
                    <ul
                      class="flex flex-col gap-3"
                      aria-labelledby="product-geo-suggestions-heading"
                    >
                      @for (suggestion of geoSuggestions(); track suggestion.question.default) {
                        <li class="border border-line p-4">
                          <p class="text-sm font-bold text-ink">
                            {{ suggestion.question.default }}
                          </p>
                          <p class="mt-2 text-sm text-ink-muted">
                            {{ suggestion.answer.default }}
                          </p>
                        </li>
                      }
                    </ul>
                    @if (canAcceptGeo()) {
                      <div>
                        <app-button
                          variant="primary"
                          size="sm"
                          data-testid="product-geo-accept-button"
                          [loading]="geoAccepting()"
                          [disabled]="geoAccepting()"
                          (clicked)="onAcceptSuggestions()"
                        >
                          {{ geoAccepting() ? 'Accepting…' : 'Accept all suggestions' }}
                        </app-button>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="tabular text-sm text-ink-muted" data-testid="product-geo-empty">
                    Content is AI-ready — no new FAQ suggestions.
                  </p>
                }
              </div>
            }
          </section>
        }

        @if (canViewSeo()) {
          <section
            class="border border-line bg-surface"
            aria-labelledby="product-seo-heading"
            data-testid="product-seo-section"
          >
            <header class="px-5 py-4 border-b border-line">
              <h2 id="product-seo-heading" class="text-xs tracking-widest uppercase text-ink-muted">
                Search index
              </h2>
            </header>
            <div class="px-5 py-5">
              <app-seo-index-state-badge [productId]="p.id" />
            </div>
          </section>
        }
      }
    </section>
  `,
})
export class ProductDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly productsService = inject(ProductsService);
  private readonly assetsService = inject(AssetsService);
  private readonly geoService = inject(GeoService);
  private readonly authStore = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly destroy$ = new Subject<void>();

  @ViewChild('headingEl') private headingEl?: ElementRef<HTMLElement>;
  @ViewChild('addFaqBtn', { read: ElementRef })
  private addFaqBtn?: ElementRef<HTMLElement>;
  @ViewChild('questionInput', { read: ElementRef })
  private questionInput?: ElementRef<HTMLElement>;

  private faqFormOrigin: string | null = null;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly product = signal<Product | null>(null);
  readonly restoring = signal(false);
  readonly restoreAnnouncement = signal<string | null>(null);
  readonly canEdit = computed(() => this.authStore.hasPermission('products:update'));
  readonly canViewStock = computed(() => this.authStore.hasPermission('inventory:view'));
  readonly productStock = signal<ProductStock | null>(null);
  readonly stockError = signal<string | null>(null);

  stockFor(variantId: string): ProductStockVariant | null {
    return this.productStock()?.variants.find((v) => v.variantId === variantId) ?? null;
  }

  /**
   * Category chips for the read view.
   *
   * Reads only the joined `category` the product payload already carries, so
   * this never fetches the tree and never needs `categories:view`. A junction
   * row whose join is absent still renders, falling back to its id, because
   * showing "one category we cannot name" is honest where showing nothing
   * would read as "no categories".
   */
  /**
   * Specification rows for the read view, already ordered by the API include.
   * Resolved through the same reducer every other admin surface uses, so a
   * Translatable can never reach the template unreduced. Binding one directly
   * is the defect the entity-rendering recurrence guard exists to catch.
   */
  readonly specRows = computed(() =>
    (this.product()?.specs ?? []).map((row) => ({
      id: row.id,
      label: pickTranslatable(
        row.label,
        this.authStore.locale(),
        this.storeSettings.defaultLocale(),
      ),
      value: pickTranslatable(
        row.value,
        this.authStore.locale(),
        this.storeSettings.defaultLocale(),
      ),
    })),
  );

  readonly categoryNames = computed(() =>
    (this.product()?.categories ?? []).map((row) => ({
      id: row.categoryId,
      label: row.category?.name
        ? pickTranslatable(
            row.category.name,
            this.authStore.locale(),
            this.storeSettings.defaultLocale(),
          )
        : (row.category?.slug ?? row.categoryId),
    })),
  );
  readonly canRestore = computed(() => {
    const p = this.product();
    return p !== null && p.deletedAt != null && this.canEdit();
  });
  readonly canCreateFaq = computed(() => this.authStore.hasPermission('products:create'));
  readonly canUpdateFaq = computed(() => this.authStore.hasPermission('products:update'));
  readonly canDeleteFaq = computed(() => this.authStore.hasPermission('products:delete'));
  readonly canViewGeo = computed(() => this.authStore.hasPermission('geo:view'));
  readonly canAcceptGeo = computed(() => this.authStore.hasPermission('geo:create'));
  readonly canViewSeo = computed(() => this.authStore.hasPermission('seo:view'));

  readonly faqPending = signal(false);
  readonly faqError = signal<string | null>(null);
  readonly faqAnnouncement = signal<string | null>(null);
  /** 'new' while creating, a faq id while editing, null when form is closed. */
  readonly editingFaq = signal<string | null>(null);

  readonly geoLoading = signal(true);
  readonly geoError = signal<string | null>(null);
  readonly geoAnnouncement = signal<string | null>(null);
  readonly geoAccepting = signal(false);
  readonly geoSuggestions = signal<FaqItem[]>([]);

  readonly faqForm = this.fb.nonNullable.group({
    question: ['', [Validators.required, Validators.maxLength(500)]],
    answer: ['', [Validators.required, Validators.maxLength(2000)]],
  });

  // Plain methods, not computed(): Reactive-Forms getters read their backing
  // signal through untracked(), so a computed() over faqForm validity freezes at
  // its initial value under zoneless CD and the FAQ errors never update on typing.
  // A method re-evaluates each CD pass the input (input) event already schedules.
  questionError(): string | null {
    const c = this.faqForm.controls.question;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('required')) return 'Question is required.';
    if (c.hasError('maxlength')) return 'Question is too long.';
    return null;
  }

  answerError(): string | null {
    const c = this.faqForm.controls.answer;
    if (!c.touched && !c.dirty) return null;
    if (c.hasError('required')) return 'Answer is required.';
    if (c.hasError('maxlength')) return 'Answer is too long.';
    return null;
  }

  /** Which of the two description branches the read view renders. */
  protected descriptionIsRich(product: { description?: unknown }): boolean {
    return looksLikeRichTextHtml(this.pickTranslatable(product.description));
  }

  protected readonly pickTranslatable = (value: unknown): string =>
    pickTranslatable(value, this.authStore.locale(), this.storeSettings.defaultLocale());
  protected readonly statusTone = productStatusTone;
  protected readonly qualityTone = qualityTone;

  /**
   * Asset.alt is a Translatable JSONB on the backend, but the global
   * locale-resolution interceptor may have narrowed it to a string by
   * the time it reaches the admin (X-Resolve-Locale defaults to true
   * for read paths). Handles both shapes plus null for decorative
   * fallback.
   */
  protected resolveAssetAlt(alt: Translatable | string | null | undefined): string {
    if (alt === null || alt === undefined) return '';
    if (typeof alt === 'string') return alt;
    return pickTranslatable(alt, this.authStore.locale(), this.storeSettings.defaultLocale());
  }

  /**
   * AV3 — media-strip thumb URL via the resolver shim. Picks the
   * `'thumbnail'` intent → `thumbnail` variant. Returns null when the
   * row's `asset` envelope lacks a usable `variants` payload (e.g. legacy
   * GET response from before AV3.18 widened the backend select); the
   * template falls back to a type-label `<p>` block in those cases.
   */
  protected stripSrc(asset: {
    id: string;
    status?: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
    variants?: unknown;
  }): string | null {
    return (
      this.assetsService.tryPublicVariantUrl(
        { id: asset.id, status: asset.status ?? 'READY', variants: asset.variants },
        'thumbnail',
      )?.url ?? null
    );
  }

  /**
   * Per-thumb accessible name. Each link routes to the same edit page, so
   * the spec must distinguish them by position + primary marker (WCAG 2.4.6
   * Headings and Labels). The visible <img alt> already names the content;
   * this aria-label adds the management context.
   */
  protected thumbAriaLabel(
    row: { isPrimary: boolean; asset?: { type: string } },
    index: number,
    total: number,
  ): string {
    const primarySuffix = row.isPrimary ? ' (primary)' : '';
    const typeLabel = row.asset?.type.toLowerCase() ?? 'asset';
    return `Manage media — ${typeLabel} ${index + 1} of ${total}${primarySuffix}`;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const id = params.get('id');
      if (!id) {
        this.error.set('Missing product id.');
        this.loading.set(false);
        this.geoLoading.set(false);
        return;
      }
      this.fetch(id);
      if (this.canViewGeo()) this.loadGeo(id);
      else this.geoLoading.set(false);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
          this.loading.set(false);
          this.loadStock(product.id);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  /**
   * Stock is supplementary on this read-only screen, so a failure leaves the
   * product rendered. It still reports: a bare dash would read as "no stock"
   * rather than "could not load", which is the silent-swallow shape.
   */
  private loadStock(id: string): void {
    if (!this.canViewStock()) return;
    this.productsService
      .getProductStock(id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stock) => {
          this.productStock.set(stock);
          this.stockError.set(null);
        },
        error: (err: unknown) => {
          this.productStock.set(null);
          this.stockError.set(
            err instanceof ApiForbiddenError
              ? 'You do not have permission to view stock.'
              : 'Could not load stock for this product.',
          );
        },
      });
  }

  private refreshProduct(): void {
    const p = this.product();
    if (!p) return;
    this.productsService
      .getProduct(p.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (fresh) => this.product.set(fresh),
        // query-error-guard: allow — background re-read after a mutation that
        // already reported its own outcome; the screen keeps the value it has.
        error: () => undefined,
      });
  }

  /**
   * Per-product only. The store-wide readiness score and its signals used to
   * render here too, which put a store metric on a product page (finding E4);
   * they live on `/seo/health` now.
   */
  private loadGeo(productId: string): void {
    this.geoLoading.set(true);
    this.geoError.set(null);
    this.geoService
      .getFaqSuggestions(productId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (suggestions) => {
          this.geoSuggestions.set(suggestions.data);
          this.geoLoading.set(false);
        },
        error: (err: unknown) => {
          this.geoSuggestions.set([]);
          this.geoError.set(this.formatGeoError(err));
          this.geoLoading.set(false);
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiNotFoundError) return 'Product not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to view this product.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load product. Please retry.';
  }

  async onRestoreClick(): Promise<void> {
    const p = this.product();
    if (!p || this.restoring() || !this.canRestore()) return;

    const ok = await openConfirmDialog(this.dialog, {
      title: 'Restore product?',
      body: 'This will set the product back to Draft status. You can edit or publish it after restoring.',
      confirmLabel: 'Restore',
      cancelLabel: 'Cancel',
      tone: 'neutral',
    });
    if (!ok) return;

    this.restoring.set(true);
    this.error.set(null);
    this.restoreAnnouncement.set(null);

    this.productsService
      .restoreProduct(p.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (restored) => {
          this.product.set(restored);
          this.restoring.set(false);
          this.restoreAnnouncement.set(
            `Product ${pickTranslatable(restored.name, this.authStore.locale(), this.storeSettings.defaultLocale())} restored to Draft.`,
          );
          queueMicrotask(() => this.headingEl?.nativeElement.focus());
        },
        error: (err: unknown) => {
          this.restoring.set(false);
          this.error.set(this.formatRestoreError(err));
        },
      });
  }

  private formatRestoreError(err: unknown): string {
    if (err instanceof ApiNotFoundError) return 'Product not found.';
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to restore this product.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not restore product. Please retry.';
  }

  onAddFaqClick(): void {
    if (!this.canCreateFaq()) return;
    this.faqError.set(null);
    this.faqForm.reset({ question: '', answer: '' });
    this.faqFormOrigin = 'product-faq-add';
    this.editingFaq.set('new');
    this.focusQuestionInput();
  }

  onEditFaqClick(faq: ProductFaqRef): void {
    if (!this.canUpdateFaq()) return;
    this.faqError.set(null);
    this.faqForm.reset({
      question: faq.question?.default ?? '',
      answer: faq.answer?.default ?? '',
    });
    this.faqFormOrigin = `product-faq-edit-${faq.id}`;
    this.editingFaq.set(faq.id);
    this.focusQuestionInput();
  }

  onCancelFaqClick(): void {
    this.editingFaq.set(null);
    this.faqError.set(null);
    this.restoreFaqTriggerFocus();
  }

  private focusQuestionInput(): void {
    queueMicrotask(() => {
      const input = this.questionInput?.nativeElement.querySelector<HTMLElement>('input, textarea');
      input?.focus();
    });
  }

  private restoreFaqTriggerFocus(): void {
    const origin = this.faqFormOrigin;
    this.faqFormOrigin = null;
    queueMicrotask(() => {
      if (!origin) return;
      const trigger = document.querySelector<HTMLElement>(
        `[data-testid="${origin}"] button, [data-testid="${origin}"]`,
      );
      trigger?.focus();
      if (!trigger) this.addFaqBtn?.nativeElement.querySelector('button')?.focus();
    });
  }

  onSaveFaq(): void {
    const p = this.product();
    const target = this.editingFaq();
    if (!p || target === null || this.faqPending()) return;
    this.faqForm.markAllAsTouched();
    if (this.faqForm.invalid) return;

    const { question, answer } = this.faqForm.getRawValue();
    const payload = {
      question: { default: question },
      answer: { default: answer },
    };

    this.faqPending.set(true);
    this.faqError.set(null);

    const request$ =
      target === 'new'
        ? this.productsService.createFaq(p.id, payload)
        : this.productsService.updateFaq(p.id, target, payload);

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        const copy = target === 'new' ? 'created' : 'updated';
        this.faqAnnouncement.set(`FAQ ${copy}.`);
        this.faqPending.set(false);
        this.editingFaq.set(null);
        this.refreshProduct();
        this.restoreFaqTriggerFocus();
      },
      error: (err: unknown) => {
        this.faqPending.set(false);
        this.faqError.set(this.formatFaqError(err));
      },
    });
  }

  async onDeleteFaqClick(faq: ProductFaqRef): Promise<void> {
    const p = this.product();
    if (!p || !this.canDeleteFaq() || this.faqPending()) return;

    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete FAQ?',
      body: pickTranslatable(
        faq.question,
        this.authStore.locale(),
        this.storeSettings.defaultLocale(),
      ),
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'destructive',
    });
    if (!ok) return;

    this.faqPending.set(true);
    this.faqError.set(null);

    this.productsService
      .deleteFaq(p.id, faq.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.faqPending.set(false);
          this.faqAnnouncement.set('FAQ deleted.');
          this.refreshProduct();
        },
        error: (err: unknown) => {
          this.faqPending.set(false);
          this.faqError.set(this.formatFaqError(err));
        },
      });
  }

  private formatFaqError(err: unknown): string {
    if (err instanceof ApiNotFoundError) return 'FAQ not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to modify FAQs.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save FAQ. Please retry.';
  }

  onAcceptSuggestions(): void {
    const p = this.product();
    const suggestions = this.geoSuggestions();
    if (!p || !this.canAcceptGeo() || this.geoAccepting() || suggestions.length === 0) return;

    this.geoAccepting.set(true);
    this.geoError.set(null);

    this.geoService
      .acceptFaqSuggestions(p.id, { faqs: suggestions })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.geoAccepting.set(false);
          this.geoSuggestions.set([]);
          this.geoAnnouncement.set(`${res.data.length} FAQ suggestions accepted.`);
          this.refreshProduct();
        },
        error: (err: unknown) => {
          this.geoAccepting.set(false);
          this.geoError.set(this.formatGeoError(err));
        },
      });
  }

  private formatGeoError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to use AI readiness.';
    if (err instanceof ApiNotFoundError) return 'AI readiness data not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load AI readiness. Please retry.';
  }
}
