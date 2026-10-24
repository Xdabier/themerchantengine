import { ApiError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent, FormFieldComponent, InputComponent, SkeletonComponent } from '@admin-ui';
import {
  AnalyticsService,
  type PixelConfig,
  type UpdatePixelsRequest,
  updatePixelsRequestSchema,
} from '@admin-services';
import { Subject, takeUntil } from 'rxjs';

interface PixelsFormShape {
  googleAnalyticsId: FormControl<string>;
  metaPixelId: FormControl<string>;
  tiktokPixelId: FormControl<string>;
  snapPixelId: FormControl<string>;
}

const PATTERNS = {
  googleAnalyticsId: /^[A-Za-z0-9-]*$/,
  metaPixelId: /^[0-9]*$/,
  tiktokPixelId: /^[A-Za-z0-9]*$/,
  snapPixelId: /^[A-Za-z0-9-]*$/,
} as const;

/**
 * `/analytics/pixels` — tracking pixel configuration.
 * Reactive form mirroring `UpdatePixelsAdminDto` regexes server-side. Submit
 * stays disabled while invalid or untouched. PATCH response re-hydrates the
 * form so subsequent edits start from the persisted value.
 */
@Component({
  selector: 'app-analytics-pixels-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="analytics-pixels-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Analytics</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Tracking pixels</h1>
        <p class="mt-3 max-w-prose text-ink text-sm">
          Pixel IDs for Google Analytics, Meta, TikTok, and Snap. Empty field clears a pixel.
        </p>
      </header>

      <div
        class="min-h-[2rem] max-w-sm"
        data-testid="pixels-form-error"
        role="alert"
        aria-atomic="true"
      >
        @if (error()) {
          <p class="border border-status-error text-ink p-3 text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <app-skeleton height="16rem" width="100%" />
      } @else {
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="flex flex-col gap-6 max-w-lg"
          data-testid="pixels-form"
          novalidate
        >
          <app-form-field
            label="Google Analytics measurement ID"
            fieldId="pixels-ga"
            [error]="controlError('googleAnalyticsId')"
            hint="e.g. G-XXXXXXX"
            data-testid="pixels-form-ga"
          >
            <app-input
              id="pixels-ga"
              formControlName="googleAnalyticsId"
              [invalid]="isInvalid('googleAnalyticsId')"
              placeholder="G-XXXXXXX"
            />
            <span data-testid="pixels-form-ga-error" class="sr-only" aria-hidden="true">
              @if (isInvalid('googleAnalyticsId')) {
                {{ controlError('googleAnalyticsId') }}
              }
            </span>
          </app-form-field>

          <app-form-field
            label="Meta pixel ID"
            fieldId="pixels-meta"
            [error]="controlError('metaPixelId')"
            hint="Numeric only"
            data-testid="pixels-form-meta"
          >
            <app-input
              id="pixels-meta"
              formControlName="metaPixelId"
              [invalid]="isInvalid('metaPixelId')"
              placeholder="123456789012345"
              inputmode="numeric"
            />
          </app-form-field>

          <app-form-field
            label="TikTok pixel ID"
            fieldId="pixels-tiktok"
            [error]="controlError('tiktokPixelId')"
            hint="Alphanumeric"
            data-testid="pixels-form-tiktok"
          >
            <app-input
              id="pixels-tiktok"
              formControlName="tiktokPixelId"
              [invalid]="isInvalid('tiktokPixelId')"
              placeholder="ABC123XYZ"
            />
          </app-form-field>

          <app-form-field
            label="Snap pixel ID"
            fieldId="pixels-snap"
            [error]="controlError('snapPixelId')"
            hint="Alphanumeric, dashes allowed"
            data-testid="pixels-form-snap"
          >
            <app-input
              id="pixels-snap"
              formControlName="snapPixelId"
              [invalid]="isInvalid('snapPixelId')"
              placeholder="snap-xyz-123"
            />
          </app-form-field>

          <div class="flex items-center gap-4">
            <app-button
              type="submit"
              variant="primary"
              [disabled]="form.invalid || form.pristine || saving()"
              [loading]="saving()"
              data-testid="pixels-form-submit"
            >
              Save pixels
            </app-button>
            <p
              class="text-xs tracking-widest uppercase text-ink min-h-[1rem]"
              data-testid="pixels-form-saved"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              @if (saved()) {
                Saved
              }
            </p>
          </div>
        </form>
      }
    </section>
  `,
})
export class AnalyticsPixelsPage implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly service = inject(AnalyticsService);
  private readonly destroy$ = new Subject<void>();

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group<PixelsFormShape>({
    googleAnalyticsId: this.fb.control('', [
      Validators.maxLength(50),
      Validators.pattern(PATTERNS.googleAnalyticsId),
    ]),
    metaPixelId: this.fb.control('', [
      Validators.maxLength(50),
      Validators.pattern(PATTERNS.metaPixelId),
    ]),
    tiktokPixelId: this.fb.control('', [
      Validators.maxLength(50),
      Validators.pattern(PATTERNS.tiktokPixelId),
    ]),
    snapPixelId: this.fb.control('', [
      Validators.maxLength(50),
      Validators.pattern(PATTERNS.snapPixelId),
    ]),
  });

  ngOnInit(): void {
    this.service
      .getPixels()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config) => {
          this.applyConfig(config);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.error.set(this.formatError(err));
          this.loading.set(false);
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  submit(): void {
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const payload: UpdatePixelsRequest = {
      googleAnalyticsId: raw.googleAnalyticsId,
      metaPixelId: raw.metaPixelId,
      tiktokPixelId: raw.tiktokPixelId,
      snapPixelId: raw.snapPixelId,
    };
    const parsed = updatePixelsRequestSchema.safeParse(payload);
    if (!parsed.success) {
      this.error.set('Validation failed — fix highlighted fields.');
      return;
    }
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.service
      .updatePixels(parsed.data)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config) => {
          this.applyConfig(config);
          this.saving.set(false);
          this.saved.set(true);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  isInvalid(key: keyof PixelsFormShape): boolean {
    const ctrl = this.form.controls[key];
    return ctrl.invalid && (ctrl.touched || ctrl.dirty);
  }

  controlError(key: keyof PixelsFormShape): string | null {
    const ctrl = this.form.controls[key];
    if (!ctrl.errors || !(ctrl.touched || ctrl.dirty)) return null;
    if (ctrl.errors['pattern']) return 'Invalid format.';
    if (ctrl.errors['maxlength']) return 'Too long (max 50 characters).';
    return 'Invalid value.';
  }

  private applyConfig(config: PixelConfig): void {
    this.form.reset({
      googleAnalyticsId: config.googleAnalyticsId ?? '',
      metaPixelId: config.metaPixelId ?? '',
      tiktokPixelId: config.tiktokPixelId ?? '',
      snapPixelId: config.snapPixelId ?? '',
    });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage pixels.';
    if (err instanceof ApiNotFoundError) return 'Pixel config not found.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not save pixels.';
  }
}
