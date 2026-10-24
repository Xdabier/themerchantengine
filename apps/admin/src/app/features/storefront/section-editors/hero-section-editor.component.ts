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
import type { HeroSectionForm } from './build-config-forms';

/**
 * `HERO` sub-form per DR-04 / DR-05. Drives `HeroBannerComponent` on the
 * storefront. Imagery is referenced by `assetId` (DR-06 picker is the only
 * input — operators do not paste raw URLs). User-facing strings flow through
 * `app-translatable-input` per constitution §3.2; the CTA href accepts a
 * relative path or a full URL (validated server-side).
 */
@Component({
  selector: 'app-hero-section-editor',
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
    <div class="flex flex-col gap-5" [formGroup]="form()" data-testid="hero-section-editor">
      <div role="group" aria-labelledby="hero-asset-label" class="flex flex-col gap-2">
        <p id="hero-asset-label" class="text-sm font-medium text-ink">
          Image asset <span aria-hidden="true">*</span>
        </p>
        <div class="flex items-center gap-3">
          <span
            class="tabular text-xs text-ink-muted truncate min-w-0 max-w-[24ch]"
            data-testid="hero-asset-id"
          >
            {{ form().controls.assetId.value || 'No image selected' }}
          </span>
          <app-button
            type="button"
            variant="ghost"
            size="sm"
            [ariaLabel]="form().controls.assetId.value ? 'Change hero image' : 'Choose hero image'"
            (clicked)="pickAsset()"
            data-testid="hero-asset-pick"
          >
            {{ form().controls.assetId.value ? 'Change image' : 'Choose image' }}
          </app-button>
        </div>
      </div>

      <app-form-field label="Eyebrow" fieldId="hero-eyebrow" [required]="true">
        <app-translatable-input
          formControlName="eyebrow"
          label="Eyebrow"
          inputId="hero-eyebrow"
          idPrefix="hero-eyebrow"
          testId="hero-eyebrow"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="Headline" fieldId="hero-headline" [required]="true">
        <app-translatable-input
          formControlName="headline"
          label="Headline"
          inputId="hero-headline"
          idPrefix="hero-headline"
          testId="hero-headline"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="Body copy" fieldId="hero-body" [required]="true">
        <app-translatable-input
          formControlName="body"
          label="Body"
          inputId="hero-body"
          idPrefix="hero-body"
          testId="hero-body"
          [multiline]="true"
          [rows]="3"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field label="Call-to-action label" fieldId="hero-cta" [required]="true">
        <app-translatable-input
          formControlName="cta"
          label="CTA"
          inputId="hero-cta"
          idPrefix="hero-cta"
          testId="hero-cta"
        ></app-translatable-input>
      </app-form-field>

      <app-form-field
        label="CTA link"
        fieldId="hero-cta-href"
        [required]="true"
        hint="Path or URL for the CTA — e.g. /catalog or https://store.example/sale."
      >
        <app-input
          id="hero-cta-href"
          formControlName="ctaHref"
          inputmode="url"
          autocomplete="off"
          data-testid="hero-cta-href"
        ></app-input>
      </app-form-field>

      <app-form-field
        label="Image alt text (optional)"
        fieldId="hero-image-alt"
        hint="Override the brand decorative panel's alt copy."
      >
        <app-translatable-input
          formControlName="imageAlt"
          label="Alt text"
          inputId="hero-image-alt"
          idPrefix="hero-image-alt"
          testId="hero-image-alt"
        ></app-translatable-input>
      </app-form-field>
    </div>
  `,
})
export class HeroSectionEditorComponent {
  private readonly dialog = inject(Dialog);

  readonly form = input.required<HeroSectionForm>();

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
