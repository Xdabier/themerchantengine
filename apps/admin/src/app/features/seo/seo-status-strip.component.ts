import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BadgeComponent, type BadgeTone, ButtonComponent, SkeletonComponent } from '@admin-ui';
import type { SubmissionHealth, SubmissionHealthState } from '@admin-services';

type CellState = SubmissionHealthState | 'ok' | 'error';

interface StatusCell {
  label: string;
  state: CellState;
  detail: string;
}

/** Map an engine submission-health state to a brand badge tone + human label. */
const STATE_TONE: Record<CellState, BadgeTone> = {
  ok: 'success',
  disabled: 'neutral',
  stale: 'warning',
  missing: 'error',
  error: 'error',
};
const STATE_LABEL: Record<CellState, string> = {
  ok: 'OK',
  disabled: 'Disabled',
  stale: 'Stale',
  missing: 'Missing',
  error: 'Error',
};

/**
 * Submission-health status strip for the SEO indexing dashboard (DR-17 D3).
 * Presentational: renders the cached snapshot the daily probe writes (or the
 * fresh one a "Re-check now" returns) — never probes the engines itself. The
 * single live probe is the parent's `recheck` handler, route-throttled to
 * 1 / 5 min.
 */
@Component({
  selector: 'app-seo-status-strip',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="border border-line bg-surface p-5 flex flex-col gap-4"
      aria-labelledby="seo-status-strip-heading"
      data-testid="seo-status-strip"
    >
      <header class="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2
            id="seo-status-strip-heading"
            class="text-xs tracking-widest uppercase text-ink-muted font-normal"
          >
            Submission health
          </h2>
          <p class="mt-1 text-sm text-ink" data-testid="seo-status-checked-at">
            @if (health(); as h) {
              Last checked {{ formatTime(h.checkedAt) }}
            } @else {
              No health probe recorded yet.
            }
          </p>
        </div>
        @if (canManage()) {
          <app-button
            variant="secondary"
            size="sm"
            [disabled]="rechecking()"
            [attr.aria-busy]="rechecking() ? 'true' : null"
            (clicked)="recheck.emit()"
            data-testid="seo-status-recheck"
          >
            {{ rechecking() ? 'Re-checking…' : 'Re-check now' }}
          </app-button>
        }
      </header>

      @if (loading()) {
        <div class="grid gap-3 sm:grid-cols-3">
          @for (_ of skeletons; track $index) {
            <app-skeleton height="2.5rem" />
          }
        </div>
      } @else {
        <dl class="grid gap-3 sm:grid-cols-3" data-testid="seo-status-cells">
          @for (cell of cells(); track cell.label) {
            <div class="border border-line p-3 flex flex-col gap-2">
              <dt class="text-xs tracking-widest uppercase text-ink-muted">{{ cell.label }}</dt>
              <dd class="flex items-center gap-2 m-0">
                <app-badge
                  [tone]="tone(cell.state)"
                  [ariaLabel]="cell.label + ': ' + stateLabel(cell.state)"
                >
                  {{ stateLabel(cell.state) }}
                </app-badge>
                <span class="text-xs text-ink-muted break-all">{{ cell.detail }}</span>
              </dd>
            </div>
          }
        </dl>
      }
    </section>
  `,
})
export class SeoStatusStripComponent {
  readonly health = input<SubmissionHealth | null>(null);
  readonly loading = input(false);
  readonly canManage = input(false);
  readonly rechecking = input(false);
  readonly recheck = output<void>();

  protected readonly skeletons = [0, 1, 2];

  protected readonly cells = computed<StatusCell[]>(() => {
    const h = this.health();
    if (!h) return [];
    return [
      { label: 'Google', state: h.gsc.state, detail: h.gsc.detail },
      { label: 'Bing', state: h.bing.state, detail: h.bing.detail },
      { label: 'Public sitemap', state: h.publicSitemap.state, detail: h.publicSitemap.detail },
    ];
  });

  protected tone(state: CellState): BadgeTone {
    return STATE_TONE[state] ?? 'neutral';
  }

  protected stateLabel(state: CellState): string {
    return STATE_LABEL[state] ?? state;
  }

  protected formatTime(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
  }
}
