import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  FormFieldComponent,
  InputComponent,
  SkeletonComponent,
  TranslatableInputComponent,
  openConfirmDialog,
  type TranslatableValue,
} from '@admin-ui';
import {
  CampaignsService,
  type Campaign,
  type CampaignSegment,
  type CreateCampaignRequest,
  type PreviewCampaignResponse,
  type UpdateCampaignRequest,
} from '@admin-services';
import { ApiError, ApiConflictError, ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { Observable, Subject, takeUntil } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { campaignStatusLabel, segmentLabel } from './campaigns.utils';
import { TRANSLATABLE_LOCALES, localeTabCodes } from '@admin-ui/atoms/translatable-locales.token';
import { localeLabel } from '../../shared/format/locale';

const SEGMENTS: ReadonlyArray<{ value: CampaignSegment; label: string }> = [
  { value: 'ALL_CONFIRMED', label: 'All confirmed subscribers' },
  { value: 'ACTIVE', label: 'Active customers' },
  { value: 'LOYAL', label: 'Loyal customers' },
  { value: 'NEW', label: 'New customers' },
  { value: 'AT_RISK', label: 'At-risk customers' },
  { value: 'CHURNED', label: 'Churned customers' },
  { value: 'LAPSED', label: 'Lapsed customers' },
];

const CAMPAIGN_TOKENS = ['couponCode', 'discountLabel', 'shopUrl'];

function asTranslatable(v: unknown): TranslatableValue {
  if (v && typeof v === 'object') return v as TranslatableValue;
  return { default: '' };
}

function extractTokens(text: string): string[] {
  const out: string[] = [];
  const re = /\{\{\{?\s*([\w.]+)\s*\}?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

function translatableTokens(v: TranslatableValue | null | undefined): string[] {
  if (!v || typeof v !== 'object') return [];
  return Object.values(v).flatMap((s) => (typeof s === 'string' ? extractTokens(s) : []));
}

/** `/campaigns/new` + `/campaigns/:id` — compose, preview, test, and send a campaign. */
@Component({
  selector: 'app-campaign-editor-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    FormFieldComponent,
    InputComponent,
    SkeletonComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="campaign-editor-page">
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/campaigns"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
          >Campaigns</a
        >
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">{{
          isNew() ? 'New campaign' : (current()?.name ?? '…')
        }}</span>
      </nav>

      <div role="alert" data-testid="campaign-editor-error">
        @if (error()) {
          <p class="border border-status-error text-ink p-3 tabular text-xs">
            {{ error() }}
          </p>
        }
      </div>

      @if (loading()) {
        <div class="flex flex-col gap-4">
          <app-skeleton height="3rem" width="40%" /><app-skeleton height="14rem" width="100%" />
        </div>
      } @else if (!isNew() && !current()) {
        <p class="tabular text-sm text-ink-muted">Campaign not found.</p>
      } @else {
        <header class="flex items-end justify-between gap-6 flex-wrap">
          <div class="min-w-0">
            <p class="text-xs tracking-widest uppercase text-ink-muted">Marketing campaign</p>
            <h1 class="mt-2 text-3xl md:text-4xl font-bold tracking-tight truncate">
              {{ isNew() ? 'New campaign' : current()?.name }}
            </h1>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            @if (!isNew() && current()) {
              <app-badge
                [tone]="statusTone(current()!.status)"
                [ariaLabel]="campaignStatusLabel(current()!.status)"
                >{{ campaignStatusLabel(current()!.status) }}</app-badge
              >
            }
            <span role="status" aria-live="polite" class="inline-flex">
              @if (saved()) {
                <app-badge tone="success" ariaLabel="Changes saved">Saved</app-badge>
              }
            </span>
          </div>
        </header>

        <form
          [formGroup]="form"
          (ngSubmit)="save()"
          class="flex flex-col gap-5 max-w-3xl"
          novalidate
        >
          <app-form-field
            label="Name"
            fieldId="camp-name"
            [required]="true"
            [error]="nameError()"
            hint="Internal label — not sent to recipients."
          >
            <app-input
              id="camp-name"
              type="text"
              autocomplete="off"
              formControlName="name"
              [invalid]="!!nameError()"
              data-testid="camp-name"
            ></app-input>
          </app-form-field>

          <app-form-field label="Audience" fieldId="camp-segment" [required]="true">
            <select
              id="camp-segment"
              formControlName="segment"
              data-testid="camp-segment"
              class="w-full min-h-[44px] px-3 py-2 tabular text-sm bg-surface text-ink border border-line focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
            >
              @for (s of segments; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
          </app-form-field>

          <app-form-field
            label="Coupon code (optional)"
            fieldId="camp-coupon"
            hint="An existing active promotion code. Reference it in the body with {{
              '{{'
            }}couponCode{{ '}}' }}."
          >
            <app-input
              id="camp-coupon"
              type="text"
              autocomplete="off"
              formControlName="couponCode"
            ></app-input>
          </app-form-field>

          <app-form-field label="Subject" fieldId="camp-subject" [required]="true">
            <app-translatable-input
              formControlName="subject"
              label="Subject"
              inputId="camp-subject"
              idPrefix="camp-subject"
              testId="camp-subject"
            ></app-translatable-input>
          </app-form-field>

          <app-form-field label="Body" fieldId="camp-body" [required]="true">
            <app-translatable-input
              formControlName="body"
              label="Body"
              [multiline]="true"
              inputId="camp-body"
              idPrefix="camp-body"
              testId="camp-body"
            ></app-translatable-input>
          </app-form-field>

          <p class="text-xs tabular text-ink-muted">
            Available placeholders: <span class="font-mono">{{ '{{' }}couponCode{{ '}}' }}</span>,
            <span class="font-mono">{{ '{{' }}discountLabel{{ '}}' }}</span>,
            <span class="font-mono">{{ '{{' }}shopUrl{{ '}}' }}</span>.
          </p>

          @if (unknownTokens().length > 0) {
            <div
              role="alert"
              class="border border-status-warning text-ink p-3 tabular text-xs"
              data-testid="camp-token-warning"
            >
              These placeholders won't resolve:
              <span class="font-mono">{{ unknownTokens().join(', ') }}</span
              >. They'll render empty.
            </div>
          }

          <footer
            class="sticky bottom-0 -mx-6 md:-mx-10 px-6 md:px-10 py-4 bg-surface border-t border-line flex items-center justify-between gap-3 flex-wrap"
          >
            <div class="flex items-center gap-3">
              @if (!isNew() && canManage()) {
                <app-button
                  type="button"
                  variant="destructive"
                  size="sm"
                  [disabled]="busy()"
                  [loading]="busy() && action() === 'delete'"
                  (clicked)="confirmDelete()"
                  data-testid="camp-delete"
                  >Delete</app-button
                >
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
                routerLink="/campaigns"
                data-testid="camp-cancel"
                >Cancel</app-button
              >
              <app-button
                type="submit"
                variant="primary"
                size="md"
                [disabled]="form.invalid || busy() || (!isNew() && !form.dirty)"
                [loading]="busy() && action() === 'save'"
                data-testid="camp-save"
              >
                {{ isNew() ? 'Create campaign' : 'Save changes' }}
              </app-button>
            </div>
          </footer>
        </form>

        @if (!isNew() && current()) {
          <section
            class="border-t border-line pt-8 flex flex-col gap-5 max-w-3xl"
            data-testid="camp-preview-section"
          >
            <div class="flex items-end justify-between gap-4 flex-wrap">
              <div class="min-w-0">
                <h2 class="text-xs tracking-widest uppercase text-ink-muted">
                  Preview, test &amp; send
                </h2>
                <p class="mt-2 text-sm text-ink-muted max-w-xl">
                  Preview renders the saved campaign. "Send test" goes to your own inbox. "Send
                  campaign" delivers to the whole audience — this cannot be undone.
                </p>
              </div>
              <div class="flex items-center gap-2" role="group" aria-label="Preview locale">
                @for (loc of previewLocales(); track loc) {
                  <button
                    type="button"
                    class="text-xs tracking-widest uppercase px-3 py-2 border focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
                    [class.border-ink]="previewLocale() === loc"
                    [class.text-ink]="previewLocale() === loc"
                    [class.border-line]="previewLocale() !== loc"
                    [class.text-ink-muted]="previewLocale() !== loc"
                    [attr.aria-pressed]="previewLocale() === loc"
                    [attr.data-testid]="'camp-preview-locale-' + loc"
                    (click)="setPreviewLocale(loc)"
                  >
                    {{ localeLabel(loc) }}
                  </button>
                }
              </div>
            </div>

            <div class="flex items-center gap-3 flex-wrap">
              <app-button
                type="button"
                variant="secondary"
                size="sm"
                [loading]="previewBusy()"
                [disabled]="previewBusy()"
                (clicked)="runPreview()"
                data-testid="camp-preview-run"
                >Refresh preview</app-button
              >
              @if (canManage()) {
                <app-button
                  type="button"
                  variant="secondary"
                  size="sm"
                  [loading]="testBusy()"
                  [disabled]="testBusy()"
                  (clicked)="sendTest()"
                  data-testid="camp-send-test"
                  >Send test to me</app-button
                >
                @if (canSend()) {
                  <app-button
                    type="button"
                    variant="primary"
                    size="sm"
                    [loading]="busy() && action() === 'send'"
                    [disabled]="busy()"
                    (clicked)="confirmSend()"
                    data-testid="camp-send"
                    >Send campaign</app-button
                  >
                }
              }
            </div>

            <div role="alert" data-testid="camp-preview-error">
              @if (previewError()) {
                <p class="border border-status-error text-ink p-3 tabular text-xs">
                  {{ previewError() }}
                </p>
              }
            </div>
            <div role="status" aria-live="polite" data-testid="camp-notice">
              @if (notice()) {
                <p class="border border-status-success text-ink p-3 tabular text-xs">
                  {{ notice() }}
                </p>
              }
            </div>

            @if (previewResult()) {
              <div class="flex flex-col gap-2">
                <p class="text-xs tracking-widest uppercase text-ink-muted">Subject</p>
                <p class="tabular text-sm text-ink" data-testid="camp-preview-subject">
                  {{ activePreview()?.subject }}
                </p>
              </div>
              <p class="sr-only">
                The subject above is the rendered text. The body below is a visual preview only.
              </p>
              <div class="border border-line bg-preview-ground">
                <iframe
                  #previewFrame
                  title="Campaign preview"
                  aria-hidden="true"
                  class="w-full h-[28rem]"
                  sandbox=""
                  data-testid="camp-preview-frame"
                ></iframe>
              </div>
            }
          </section>
        }
      }
    </section>
  `,
})
export class CampaignEditorPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(CampaignsService);
  private readonly authStore = inject(AuthStore);
  private readonly dialog = inject(Dialog);
  private readonly fb = inject(FormBuilder);
  private readonly storeLocales = inject(TRANSLATABLE_LOCALES);
  private readonly destroy$ = new Subject<void>();

  protected readonly segments = SEGMENTS;
  /**
   * The locale tabs the preview offers: the keys the response actually carries,
   * falling back to the store's locales before a preview has run.
   *
   * Those two agree since D7 moved the mail renderer onto the store locale
   * pair. Until then they could not: the renderer emitted a fixed pair of its
   * own and a store-locale tab would have shown an empty preview, which is why
   * a bridge constant stood here. It is deleted with the mismatch it described.
   */
  protected readonly previewLocales = computed<readonly string[]>(() => {
    const keys = Object.keys(this.previewResult() ?? {});
    return keys.length > 0 ? keys : localeTabCodes(this.storeLocales());
  });
  protected readonly localeLabel = localeLabel;
  protected readonly campaignStatusLabel = campaignStatusLabel;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly current = signal<Campaign | null>(null);
  readonly isNew = signal(false);
  readonly busy = signal(false);
  readonly action = signal<'save' | 'delete' | 'send' | null>(null);
  readonly saved = signal(false);
  readonly notice = signal<string | null>(null);

  readonly previewResult = signal<PreviewCampaignResponse | null>(null);
  private readonly previewLocaleOverride = signal<string | null>(null);

  /** The selected preview locale, clamped to the tabs actually rendered. */
  readonly previewLocale = computed<string>(() => {
    const locales = this.previewLocales();
    const chosen = this.previewLocaleOverride();
    if (chosen && locales.includes(chosen)) return chosen;
    return locales[0] ?? '';
  });
  readonly previewBusy = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly testBusy = signal(false);
  readonly unknownTokens = signal<readonly string[]>([]);
  private readonly previewFrame = viewChild<ElementRef<HTMLIFrameElement>>('previewFrame');

  readonly activePreview = computed(() => {
    const r = this.previewResult();
    return r ? (r[this.previewLocale()] ?? null) : null;
  });
  readonly canManage = computed(() => this.authStore.hasAnyPermission(['campaigns:manage']));
  readonly canSend = computed(() => {
    const s = this.current()?.status;
    return s === 'DRAFT' || s === 'SCHEDULED';
  });

  readonly form = this.fb.nonNullable.group({
    name: this.fb.nonNullable.control('', [Validators.required]),
    segment: this.fb.nonNullable.control<CampaignSegment>('ALL_CONFIRMED'),
    couponCode: this.fb.nonNullable.control(''),
    subject: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [Validators.required]),
    body: this.fb.nonNullable.control<TranslatableValue>({ default: '' }, [Validators.required]),
  });

  statusTone(s: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
    switch (s) {
      case 'SENT':
        return 'success';
      case 'SCHEDULED':
      case 'SENDING':
        return 'info';
      case 'FAILED':
        return 'error';
      default:
        return 'neutral';
    }
  }

  constructor() {
    effect(() => {
      const html = this.activePreview()?.html ?? '';
      const frame = this.previewFrame();
      if (frame) frame.nativeElement.srcdoc = html;
    });
  }

  nameError(): string | null {
    const c = this.form.controls.name;
    if (!c.touched) return null;
    if (c.hasError('required')) return 'Name is required.';
    return null;
  }

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((p) => {
      const id = p.get('id');
      if (!id || id === 'new') {
        this.isNew.set(true);
        this.loading.set(false);
        return;
      }
      this.isNew.set(false);
      this.fetch(id);
    });
    this.form.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => this.recomputeTokens());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) return;
    if (!this.isNew() && !this.form.dirty) return;
    const raw = this.form.getRawValue();
    const couponCode = raw.couponCode.trim() || null;

    if (this.isNew()) {
      const body: CreateCampaignRequest = {
        name: raw.name,
        segment: raw.segment,
        subject: raw.subject,
        body: raw.body,
        ...(couponCode ? { couponCode } : {}),
      };
      this.run('save', this.service.createCampaign(body), (c) =>
        this.router.navigate(['/campaigns', c.id]),
      );
      return;
    }

    const body: UpdateCampaignRequest = {
      name: raw.name,
      segment: raw.segment,
      subject: raw.subject,
      body: raw.body,
      couponCode,
    };
    this.run('save', this.service.updateCampaign(this.current()!.id, body), (c) => {
      this.current.set(c);
      this.seedForm(c);
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 3000);
    });
  }

  async confirmDelete(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete this campaign?',
      body: `"${current.name}" will be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    this.run('delete', this.service.deleteCampaign(current.id), () =>
      this.router.navigate(['/campaigns']),
    );
  }

  async confirmSend(): Promise<void> {
    const current = this.current();
    if (!current || this.busy()) return;
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Send this campaign?',
      body: `"${current.name}" will be delivered to the "${segmentLabel(current.segment)}" audience. This cannot be undone.`,
      confirmLabel: 'Send now',
      tone: 'neutral',
    });
    if (!ok) return;
    this.busy.set(true);
    this.action.set('send');
    this.error.set(null);
    this.service.sendCampaign(current.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.action.set(null);
        this.notice.set('Campaign is sending.');
        this.fetch(current.id);
        setTimeout(() => this.notice.set(null), 4000);
      },
      error: (err: unknown) => this.failAction(err, 'Could not send the campaign.'),
    });
  }

  setPreviewLocale(locale: string): void {
    this.previewLocaleOverride.set(locale);
  }

  runPreview(): void {
    const cur = this.current();
    if (!cur || this.previewBusy()) return;
    const raw = this.form.getRawValue();
    this.previewBusy.set(true);
    this.previewError.set(null);
    this.service
      .preview(cur.id, { subject: raw.subject, body: raw.body })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.previewResult.set(res);
          this.previewBusy.set(false);
        },
        error: (err: unknown) => {
          this.previewBusy.set(false);
          this.previewError.set(
            err instanceof ApiError ? err.message : 'Could not render the preview.',
          );
        },
      });
  }

  sendTest(): void {
    const cur = this.current();
    if (!cur || this.testBusy()) return;
    this.testBusy.set(true);
    this.notice.set(null);
    this.previewError.set(null);
    this.service
      .sendTestCampaign(cur.id, { locale: this.previewLocale() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.testBusy.set(false);
          this.notice.set(`Sent a test to ${res.recipient}.`);
          setTimeout(() => this.notice.set(null), 4000);
        },
        error: (err: unknown) => {
          this.testBusy.set(false);
          this.previewError.set(err instanceof ApiError ? err.message : 'Could not send the test.');
        },
      });
  }

  private run<T>(action: 'save' | 'delete', obs: Observable<T>, onNext: (v: T) => void): void {
    this.busy.set(true);
    this.action.set(action);
    this.error.set(null);
    obs.pipe(takeUntil(this.destroy$)).subscribe({
      next: (v) => {
        this.busy.set(false);
        this.action.set(null);
        onNext(v);
      },
      error: (err: unknown) => this.failAction(err, 'Could not save the campaign.'),
    });
  }

  private fetch(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service
      .getCampaign(id)
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

  private seedForm(c: Campaign): void {
    this.form.reset(
      {
        name: c.name,
        segment: c.segment,
        couponCode: c.couponCode ?? '',
        subject: asTranslatable(c.subject),
        body: asTranslatable(c.body),
      },
      { emitEvent: false },
    );
    this.recomputeTokens();
  }

  private recomputeTokens(): void {
    const raw = this.form.getRawValue();
    const declared = new Set(CAMPAIGN_TOKENS);
    const used = [...translatableTokens(raw.subject), ...translatableTokens(raw.body)];
    this.unknownTokens.set([...new Set(used.filter((t) => !declared.has(t)))]);
  }

  private failAction(err: unknown, fallback: string): void {
    this.busy.set(false);
    this.action.set(null);
    this.error.set(this.formatError(err, fallback));
  }

  private formatError(err: unknown, fallback = 'Could not load the campaign.'): string {
    if (err instanceof ApiNotFoundError) return 'Campaign not found.';
    if (err instanceof ApiForbiddenError) return 'You do not have permission to manage campaigns.';
    if (err instanceof ApiConflictError) return 'This campaign can no longer be edited or sent.';
    if (err instanceof ApiError) return err.message;
    return fallback;
  }
}
