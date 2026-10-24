import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BadgeComponent, type BadgeTone, SkeletonComponent } from '@admin-ui';
import type { SeoAnalytics, SeoEngineReadState } from '@admin-services';
import { adminIntlTag } from '../../shared/format/intl-tag';

const READ_STATE_TONE: Record<SeoEngineReadState, BadgeTone> = {
  ok: 'success',
  disabled: 'neutral',
  error: 'error',
};
const READ_STATE_LABEL: Record<SeoEngineReadState, string> = {
  ok: 'Live',
  disabled: 'Not configured',
  error: 'Error',
};

/**
 * GSC Search Analytics performance block for the SEO indexing dashboard (DR-17 D4).
 * Surfaces the totals, a daily click/impression series, and the top queries + pages
 * Google reports for the catalogue. Presentational; the parent owns the 6 h-cached
 * fetch. Degrades gracefully: when Search Console is not connected it shows a short
 * explanation, never a spinner. The series + breakdowns are real `<table>`s with
 * sr-only captions (no canvas-only chart that a screen reader can't read).
 */
@Component({
  selector: 'app-seo-performance-block',
  standalone: true,
  imports: [BadgeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="border border-line bg-surface p-5 flex flex-col gap-4"
      aria-labelledby="seo-performance-heading"
      [attr.aria-busy]="loading() ? 'true' : null"
      data-testid="seo-performance-block"
    >
      <div class="flex items-center gap-2 flex-wrap">
        <h2
          id="seo-performance-heading"
          class="text-xs tracking-widest uppercase text-ink-muted font-normal"
        >
          Search performance
        </h2>
        @if (analytics(); as a) {
          <app-badge [tone]="tone(a.state)" [ariaLabel]="'Search performance: ' + label(a.state)">
            {{ label(a.state) }}
          </app-badge>
        }
      </div>

      @if (loading()) {
        <app-skeleton height="8rem" />
      } @else if (analytics(); as a) {
        @if (a.state === 'ok') {
          <!-- Totals -->
          <dl class="grid gap-3 sm:grid-cols-4" data-testid="seo-performance-metrics">
            <div class="border border-line p-3 flex flex-col gap-1">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Clicks</dt>
              <dd class="m-0 text-lg text-ink tabular-nums">{{ int(a.totals?.clicks) }}</dd>
            </div>
            <div class="border border-line p-3 flex flex-col gap-1">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Impressions</dt>
              <dd class="m-0 text-lg text-ink tabular-nums">
                {{ int(a.totals?.impressions) }}
              </dd>
            </div>
            <div class="border border-line p-3 flex flex-col gap-1">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">CTR</dt>
              <dd class="m-0 text-lg text-ink tabular-nums">{{ pct(a.totals?.ctr) }}</dd>
            </div>
            <div class="border border-line p-3 flex flex-col gap-1">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">Avg position</dt>
              <dd class="m-0 text-lg text-ink tabular-nums">
                {{ pos(a.totals?.position) }}
              </dd>
            </div>
          </dl>

          @if (a.asOf) {
            <p class="text-xs text-ink-muted" data-testid="seo-performance-asof">
              Figures for {{ a.asOf }} and later are still being collected by Google and may change.
            </p>
          }

          <!-- Daily series -->
          @if (a.series.length === 0) {
            <p class="text-xs text-ink-muted" data-testid="seo-performance-no-series">
              No search-performance data for this window yet.
            </p>
          } @else {
            <div
              class="overflow-x-auto border border-line max-h-64"
              role="group"
              tabindex="0"
              aria-label="Daily search performance, scrollable"
            >
              <table class="w-full border-collapse">
                <caption class="sr-only">
                  Daily search performance
                </caption>
                <thead class="border-b border-line">
                  <tr>
                    @for (col of seriesColumns; track col) {
                      <th
                        scope="col"
                        class="text-start text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-2"
                      >
                        {{ col }}
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (d of a.series; track d.date) {
                    <tr class="border-b border-line last:border-b-0">
                      <th
                        scope="row"
                        class="text-start font-normal px-3 py-2 text-xs text-ink-muted whitespace-nowrap"
                      >
                        {{ d.date }}
                      </th>
                      <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                        {{ int(d.clicks) }}
                      </td>
                      <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                        {{ int(d.impressions) }}
                      </td>
                      <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                        {{ pct(d.ctr) }}
                      </td>
                      <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                        {{ pos(d.position) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <!-- Top queries + pages -->
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="flex flex-col gap-2" data-testid="seo-performance-queries">
              <h3 class="text-xs tracking-widest uppercase text-ink-muted font-normal">
                Top queries
              </h3>
              @if (a.topQueries.length === 0) {
                <p class="text-xs text-ink-muted">No query data yet.</p>
              } @else {
                <div class="overflow-x-auto border border-line">
                  <table class="w-full border-collapse">
                    <caption class="sr-only">
                      Top search queries
                    </caption>
                    <thead class="border-b border-line">
                      <tr>
                        @for (col of breakdownColumns; track col) {
                          <th
                            scope="col"
                            class="text-start text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-2"
                          >
                            {{ col }}
                          </th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (q of a.topQueries; track q.query) {
                        <tr class="border-b border-line last:border-b-0">
                          <th
                            scope="row"
                            class="text-start font-normal px-3 py-2 text-xs text-ink break-all"
                          >
                            {{ q.query }}
                          </th>
                          <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                            {{ int(q.clicks) }}
                          </td>
                          <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                            {{ int(q.impressions) }}
                          </td>
                          <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                            {{ pos(q.position) }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>

            <div class="flex flex-col gap-2" data-testid="seo-performance-pages">
              <h3 class="text-xs tracking-widest uppercase text-ink-muted font-normal">
                Top pages
              </h3>
              @if (a.topPages.length === 0) {
                <p class="text-xs text-ink-muted">No page data yet.</p>
              } @else {
                <div class="overflow-x-auto border border-line">
                  <table class="w-full border-collapse">
                    <caption class="sr-only">
                      Top pages
                    </caption>
                    <thead class="border-b border-line">
                      <tr>
                        @for (col of breakdownColumns; track col) {
                          <th
                            scope="col"
                            class="text-start text-xs tracking-widest uppercase text-ink-muted font-normal px-3 py-2"
                          >
                            {{ col }}
                          </th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (p of a.topPages; track p.page) {
                        <tr class="border-b border-line last:border-b-0">
                          <th
                            scope="row"
                            class="text-start font-normal px-3 py-2 text-xs text-ink font-mono break-all"
                          >
                            {{ p.page }}
                          </th>
                          <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                            {{ int(p.clicks) }}
                          </td>
                          <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                            {{ int(p.impressions) }}
                          </td>
                          <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                            {{ pos(p.position) }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          </div>
        } @else {
          <!-- disabled / error degrade -->
          <p class="text-xs text-ink-muted" data-testid="seo-performance-degrade">
            @if (a.state === 'disabled') {
              Search performance is not connected.
            } @else {
              Could not load search performance.
            }
            {{ a.detail }}
          </p>
        }
      } @else {
        <p class="text-xs text-ink-muted" data-testid="seo-performance-empty">
          Search performance unavailable.
        </p>
      }
    </section>
  `,
})
export class SeoPerformanceBlockComponent {
  readonly analytics = input<SeoAnalytics | null>(null);
  readonly loading = input(false);

  protected readonly seriesColumns = ['Date', 'Clicks', 'Impressions', 'CTR', 'Position'];
  protected readonly breakdownColumns = ['Term', 'Clicks', 'Impressions', 'Position'];

  protected tone(state: SeoEngineReadState): BadgeTone {
    return READ_STATE_TONE[state] ?? 'neutral';
  }

  protected label(state: SeoEngineReadState): string {
    return READ_STATE_LABEL[state] ?? state;
  }

  /** Integer count, em-dash for a null/absent metric. */
  protected int(v: number | null | undefined): string {
    return v == null ? '—' : Math.round(v).toLocaleString(adminIntlTag());
  }

  /** Click-through rate as a percentage (GSC reports it as a 0–1 fraction). */
  protected pct(v: number | null | undefined): string {
    return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
  }

  /** Average position to one decimal. */
  protected pos(v: number | null | undefined): string {
    return v == null ? '—' : v.toFixed(1);
  }
}
