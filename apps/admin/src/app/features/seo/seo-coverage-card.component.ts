import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BadgeComponent, type BadgeTone, SkeletonComponent } from '@admin-ui';
import type { SeoCoverage, SeoEngineReadState } from '@admin-services';

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
 * Sitemap-coverage card for the SEO indexing dashboard (DR-17 D3). Shows what
 * Google (`sitemaps.list`) and Bing (`GetFeeds`) actually have on file —
 * submitted counts (the deprecated `indexed` count is intentionally omitted),
 * last-downloaded/crawled times, and errors. Presentational; the parent owns the
 * 6 h-cached fetch. Degrades per engine: a disabled engine shows "Not
 * configured," an error shows the short reason — never a spinner that hangs.
 */
@Component({
  selector: 'app-seo-coverage-card',
  standalone: true,
  imports: [BadgeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="border border-line bg-surface p-5 flex flex-col gap-4"
      aria-labelledby="seo-coverage-heading"
      data-testid="seo-coverage-card"
    >
      <h2
        id="seo-coverage-heading"
        class="text-xs tracking-widest uppercase text-ink-muted font-normal"
      >
        Sitemap coverage
      </h2>

      @if (loading()) {
        <app-skeleton height="6rem" />
      } @else if (coverage(); as cov) {
        <!-- Google -->
        <div class="flex flex-col gap-2" data-testid="seo-coverage-gsc">
          <div class="flex items-center gap-2">
            <span class="text-sm text-ink">Google</span>
            <app-badge
              [tone]="tone(cov.gsc.state)"
              [ariaLabel]="'Google coverage: ' + label(cov.gsc.state)"
            >
              {{ label(cov.gsc.state) }}
            </app-badge>
          </div>
          @if (cov.gsc.state === 'ok') {
            @if (cov.gsc.sitemaps.length === 0) {
              <p class="text-xs text-ink-muted">No sitemaps registered in the property yet.</p>
            } @else {
              <div class="overflow-x-auto border border-line">
                <table class="w-full border-collapse">
                  <caption class="sr-only">
                    Google sitemap coverage
                  </caption>
                  <thead class="border-b border-line">
                    <tr>
                      @for (col of gscColumns; track col) {
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
                    @for (s of cov.gsc.sitemaps; track s.path) {
                      <tr class="border-b border-line last:border-b-0">
                        <td class="px-3 py-2 text-xs text-ink font-mono break-all">
                          {{ s.path }}
                        </td>
                        <td class="px-3 py-2 text-xs text-ink tabular-nums text-end">
                          {{ s.submitted }}
                        </td>
                        <td class="px-3 py-2 text-xs text-ink-muted whitespace-nowrap">
                          {{ formatTime(s.lastDownloaded) }}
                        </td>
                        <td class="px-3 py-2 text-xs tabular-nums text-end">
                          @if (s.errors > 0) {
                            <app-badge tone="error" [ariaLabel]="s.errors + ' sitemap error(s)'">{{
                              s.errors
                            }}</app-badge>
                          } @else {
                            <span class="text-ink-muted">0</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else {
            <p class="text-xs text-ink-muted">{{ cov.gsc.detail }}</p>
          }
        </div>

        <!-- Bing -->
        <div class="flex flex-col gap-2" data-testid="seo-coverage-bing">
          <div class="flex items-center gap-2">
            <span class="text-sm text-ink">Bing</span>
            <app-badge
              [tone]="tone(cov.bing.state)"
              [ariaLabel]="'Bing coverage: ' + label(cov.bing.state)"
            >
              {{ label(cov.bing.state) }}
            </app-badge>
          </div>
          @if (cov.bing.state === 'ok') {
            @if (cov.bing.feeds.length === 0) {
              <p class="text-xs text-ink-muted">
                No sitemap feed registered in Bing Webmaster Tools.
              </p>
            } @else {
              <ul class="flex flex-col gap-1">
                @for (f of cov.bing.feeds; track f.url) {
                  <li class="text-xs text-ink flex items-center gap-2 flex-wrap">
                    <span class="font-mono break-all">{{ f.url }}</span>
                    @if (f.urlCount !== null) {
                      <span class="text-ink-muted tabular-nums">· {{ f.urlCount }} URL(s)</span>
                    }
                    @if (f.lastCrawled) {
                      <span class="text-ink-muted">· crawled {{ formatTime(f.lastCrawled) }}</span>
                    }
                  </li>
                }
              </ul>
            }
          } @else {
            <p class="text-xs text-ink-muted">{{ cov.bing.detail }}</p>
          }
        </div>
      } @else {
        <p class="text-xs text-ink-muted" data-testid="seo-coverage-empty">Coverage unavailable.</p>
      }
    </section>
  `,
})
export class SeoCoverageCardComponent {
  readonly coverage = input<SeoCoverage | null>(null);
  readonly loading = input(false);

  protected readonly gscColumns = ['Sitemap', 'Submitted', 'Last downloaded', 'Errors'];

  protected tone(state: SeoEngineReadState): BadgeTone {
    return READ_STATE_TONE[state] ?? 'neutral';
  }

  protected label(state: SeoEngineReadState): string {
    return READ_STATE_LABEL[state] ?? state;
  }

  protected formatTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
  }
}
