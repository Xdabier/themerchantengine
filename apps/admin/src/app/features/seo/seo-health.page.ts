import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { LoadErrorComponent, SkeletonComponent } from '@admin-ui';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { GeoService, SeoService, type AiReadinessReport } from '@admin-services';
import { AuthStore } from '../../core/stores/auth.store';
import { Subject, takeUntil } from 'rxjs';
import { z } from 'zod';
import { pickTranslation, type Translatable } from '@admin-types';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';

const itemSchema = z
  .object({
    id: z.string().optional(),
    slug: z.string().optional().nullable(),
    name: z.record(z.string(), z.unknown()).optional().nullable(),
    title: z.record(z.string(), z.unknown()).optional().nullable(),
    url: z.string().optional().nullable(),
  })
  .passthrough();

const sectionSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(itemSchema).default([]),
});

const healthReportSchema = z.object({
  productsMissingMeta: sectionSchema,
  productsMissingAlt: sectionSchema,
  pagesMissingMeta: sectionSchema,
});

type HealthReport = z.infer<typeof healthReportSchema>;
type HealthItem = z.infer<typeof itemSchema>;

interface HealthSection {
  readonly key: 'productsMissingMeta' | 'productsMissingAlt' | 'pagesMissingMeta';
  readonly title: string;
  readonly description: string;
  readonly testId: string;
}

const SECTIONS: readonly HealthSection[] = [
  {
    key: 'productsMissingMeta',
    title: 'Products missing meta tags',
    description: 'Products without a meta title or meta description.',
    testId: 'health-products-missing-meta',
  },
  {
    key: 'productsMissingAlt',
    title: 'Images missing alt text',
    description: 'Image assets that ship without descriptive alt.',
    testId: 'health-images-missing-alt',
  },
  {
    key: 'pagesMissingMeta',
    title: 'Pages without meta description',
    description: 'Published CMS pages that have no meta description.',
    testId: 'health-pages-without-meta-description',
  },
] as const;

@Component({
  selector: 'app-seo-health-page',
  standalone: true,
  imports: [RouterLink, LoadErrorComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="seo-health-page">
      <nav aria-label="Breadcrumb" class="text-xs text-ink-muted">
        <a routerLink="/seo/redirects" class="hover:underline">SEO</a>
        <span aria-hidden="true"> / </span>
        <span [attr.aria-current]="'page'">Health</span>
      </nav>

      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">SEO</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Health report</h1>
        <p class="mt-3 text-sm text-ink-muted">
          Surface gaps across products, images, and CMS pages that hurt SEO.
        </p>
      </header>

      @if (error()) {
        <p
          class="text-xs p-3 border border-status-error text-ink"
          role="alert"
          data-testid="seo-health-error"
        >
          {{ error() }}
        </p>
      }

      @if (canViewGeo()) {
        <section
          class="border border-line bg-surface"
          aria-labelledby="seo-readiness-heading"
          data-testid="seo-ai-readiness"
        >
          <header class="px-5 py-4 border-b border-line">
            <h2 id="seo-readiness-heading" class="text-xs tracking-widest uppercase text-ink-muted">
              AI readiness
            </h2>
          </header>

          @if (readinessError()) {
            <div class="px-5 py-4">
              <app-load-error
                [message]="readinessError()!"
                [compact]="true"
                [retrying]="readinessLoading()"
                retryLabel="AI readiness"
                testId="seo-ai-readiness-error"
                (retry)="fetchReadiness()"
              />
            </div>
          } @else if (readinessLoading()) {
            <div class="px-5 py-6 flex flex-col gap-3">
              <app-skeleton height="3rem" width="30%" />
              <app-skeleton height="1rem" width="80%" />
            </div>
          } @else if (readiness(); as report) {
            <div class="px-5 py-5 flex flex-col gap-5">
              <div class="flex items-end gap-4 flex-wrap">
                <p
                  class="text-5xl font-bold tracking-tight tabular-nums text-ink"
                  data-testid="seo-ai-readiness-score"
                >
                  {{ report.score }}
                </p>
                <p class="text-xs tracking-widest uppercase text-ink-muted pb-2">
                  Store-wide score (0–100)
                </p>
              </div>
              <dl class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="border border-line p-4">
                  <dt class="text-xs tracking-widest uppercase text-ink-muted">
                    Answer-first description
                  </dt>
                  <dd class="mt-2 text-xl font-bold tabular-nums">
                    {{ formatSignal(report.signals.answerFirstDescription) }}
                  </dd>
                </div>
                <div class="border border-line p-4">
                  <dt class="text-xs tracking-widest uppercase text-ink-muted">FAQ entries</dt>
                  <dd class="mt-2 text-xl font-bold tabular-nums">
                    {{ formatSignal(report.signals.faqEntries) }}
                  </dd>
                </div>
                <div class="border border-line p-4">
                  <dt class="text-xs tracking-widest uppercase text-ink-muted">
                    Complete schema markup
                  </dt>
                  <dd class="mt-2 text-xl font-bold tabular-nums">
                    {{ formatSignal(report.signals.completeSchemaMarkup) }}
                  </dd>
                </div>
              </dl>
            </div>
          }
        </section>
      }

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        @for (section of sections; track section.key) {
          <article
            class="border border-line bg-surface p-6 flex flex-col gap-3"
            [attr.data-testid]="section.testId"
            [attr.aria-labelledby]="'health-title-' + section.key"
          >
            <h2
              [id]="'health-title-' + section.key"
              class="text-xs tracking-widest uppercase text-ink-muted"
            >
              {{ section.title }}
            </h2>
            @if (loading()) {
              <app-skeleton height="2.5rem" />
              <app-skeleton height="0.75rem" />
            } @else {
              <p
                class="text-4xl font-mono font-bold tabular-nums text-ink"
                [attr.data-testid]="section.testId + '-count'"
              >
                {{ count(section.key) }}
              </p>
              <p class="text-xs text-ink-muted">{{ section.description }}</p>
              @if (items(section.key).length > 0) {
                <ul class="flex flex-col gap-1 mt-2">
                  @for (item of items(section.key); track $index) {
                    <li class="text-xs text-ink font-mono break-all">
                      {{ labelFor(item, section.key) }}
                    </li>
                  }
                </ul>
              } @else {
                <p class="text-xs text-ink-muted" [attr.data-testid]="section.testId + '-empty'">
                  No issues.
                </p>
              }
            }
          </article>
        }
      </div>
    </section>
  `,
})
export class SeoHealthPage implements OnInit, OnDestroy {
  private readonly seo = inject(SeoService);
  private readonly geo = inject(GeoService);
  private readonly auth = inject(AuthStore);
  private readonly storeSettings = inject(StoreSettingsStore);
  private readonly destroy$ = new Subject<void>();

  readonly sections = SECTIONS;
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly report = signal<HealthReport | null>(null);

  /**
   * Store-wide AI readiness. It used to render on every product page, where a
   * store metric read as a product metric (finding E4); this is its home.
   */
  readonly readiness = signal<AiReadinessReport | null>(null);
  readonly readinessLoading = signal(true);
  readonly readinessError = signal<string | null>(null);
  readonly canViewGeo = computed(() => this.auth.hasPermission('geo:view'));

  readonly count = computed(
    () => (key: HealthSection['key']) => this.report()?.[key]?.count ?? 0,
  )();
  readonly items = computed(
    () => (key: HealthSection['key']) =>
      (this.report()?.[key]?.items ?? []).slice(0, 5) as HealthItem[],
  )();

  ngOnInit(): void {
    this.fetch();
    if (this.canViewGeo()) this.fetchReadiness();
    else this.readinessLoading.set(false);
  }

  fetchReadiness(): void {
    this.readinessLoading.set(true);
    this.readinessError.set(null);
    this.geo
      .getAiReadiness()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (report) => {
          this.readiness.set(report);
          this.readinessLoading.set(false);
        },
        error: (err: unknown) => {
          this.readinessError.set(this.formatReadinessError(err));
          this.readinessLoading.set(false);
        },
      });
  }

  formatSignal(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  private formatReadinessError(err: unknown): string {
    if (err instanceof ApiForbiddenError) {
      return 'You do not have permission to view AI readiness.';
    }
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load AI readiness.';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  labelFor(item: HealthItem, key: HealthSection['key']): string {
    if (key === 'productsMissingAlt') return item.url ?? item.id ?? 'asset';
    const translatable = (item.name ?? item.title ?? null) as
      | Translatable
      | string
      | null
      | undefined;
    return pickTranslation(
      translatable,
      this.auth.locale(),
      item.slug || item.id || '—',
      this.storeSettings.defaultLocale(),
    );
  }

  private fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.seo
      .health()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (raw) => {
          const parsed = healthReportSchema.safeParse(raw);
          this.loading.set(false);
          if (!parsed.success) {
            this.error.set('SEO health response was malformed.');
            return;
          }
          this.report.set(parsed.data);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.formatError(err));
        },
      });
  }

  private formatError(err: unknown): string {
    if (err instanceof ApiForbiddenError)
      return 'You do not have permission to view the SEO health report.';
    if (err instanceof ApiError && err.message) return err.message;
    return 'Could not load the SEO health report. Please retry.';
  }
}
