import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import {
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  TranslatableInputComponent,
  openAssetPicker,
} from '@admin-ui';
import type { PromotionalBannerForm } from './build-config-forms';

/**
 * `PROMOTIONAL_BANNER` sub-form per DR-04 / DR-05. Drives
 * `MidCampaignBannerComponent` on the storefront. Same shape as the hero
 * editor minus the required CTA pair — promotional banners can ship without
 * a click target during a soft-launch window.
 */
@Component({
  selector: 'app-promotional-banner-section-editor',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col gap-5"
      [formGroup]="form()"
      data-testid="promotional-banner-section-editor"
    >
      <div role="group" aria-labelledby="promo-asset-label" class="flex flex-col gap-2">
        <p id="promo-asset-label" class="text-sm font-medium text-ink">
          Image asset <span aria-hidden="true">*</span>
        </p>
        <div class="flex items-center gap-3">
          <span
            class="tabular text-xs text-ink-muted truncate min-w-0 max-w-[24ch]"
            data-testid="promo-asset-id"
          >
            {{ form().controls.assetId.value || 'No image selected' }}
          </span>
          <app-button
            type="button"
            variant="ghost"
            size="sm"
            [ariaLabel]="
              form().controls.assetId.value
                ? 'Change promotional banner image'
                : 'Choose promotional banner image'
            "
            (clicked)="pickAsset()"
            data-testid="promo-asset-pick"
          >
            {{ form().controls.assetId.value ? 'Change image' : 'Choose image' }}
          </app-button>
        </div>
      </div>

      <app-form-field label="Eyebrow" fieldId="promo-eyebrow" [required]="true">
        <app-translatable-input
          formControlName="eyebrow"
          label="Eyebrow"
          inputId="promo-eyebrow"
          idPrefix="promo-eyebrow"
          testId="promo-eyebrow"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="Headline" fieldId="promo-headline" [required]="true">
        <app-translatable-input
          formControlName="headline"
          label="Headline"
          inputId="promo-headline"
          idPrefix="promo-headline"
          testId="promo-headline"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="Body copy" fieldId="promo-body" [required]="true">
        <app-translatable-input
          formControlName="body"
          label="Body"
          inputId="promo-body"
          idPrefix="promo-body"
          testId="promo-body"
          [multiline]="true"
          [rows]="3"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field
        label="CTA label (optional)"
        fieldId="promo-cta"
        hint="Leave blank for a banner without a call-to-action button."
      >
        <app-translatable-input
          formControlName="cta"
          label="CTA"
          inputId="promo-cta"
          idPrefix="promo-cta"
          testId="promo-cta"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="CTA link (optional)" fieldId="promo-cta-href">
        <app-input
          id="promo-cta-href"
          formControlName="ctaHref"
          inputmode="url"
          autocomplete="off"
          data-testid="promo-cta-href"
        ></app-input>
      </app-form-field>

      <app-form-field label="Image alt text (optional)" fieldId="promo-image-alt">
        <app-translatable-input
          formControlName="imageAlt"
          label="Alt text"
          inputId="promo-image-alt"
          idPrefix="promo-image-alt"
          testId="promo-image-alt"
        ></app-translatable-input>
      </app-form-field>
    </div>
  `,
})
export class PromotionalBannerSectionEditorComponent {
  private readonly dialog = inject(Dialog);

  readonly form = input.required<PromotionalBannerForm>();

  async pickAsset(): Promise<void> {
    const result = await openAssetPicker(this.dialog, {
      mode: 'single',
      filter: { type: 'IMAGE' },
    });
    if (result.kind === 'select-single') {
      this.form().controls.assetId.setValue(result.asset.id);
      this.form().controls.assetId.markAsDirty();
      this.form().markAsDirty();
    }
  }
}
