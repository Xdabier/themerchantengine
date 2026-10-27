import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BadgeComponent, type BadgeTone, SkeletonComponent } from '@admin-ui';
import type { SeoEngineReadState, SeoQuota } from '@admin-services';

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
 * Quota readout for the SEO indexing dashboard (DR-17 D3). Surfaces the live Bing
 * URL-submission quota (adaptive — shown verbatim, never assumed), the GSC
 * URL-Inspection daily-budget estimate, and the IndexNow dedup window.
 * Presentational; the parent owns the cached fetch. Degrades per engine.
 */
@Component({
  selector: 'app-seo-quota-readout',
  standalone: true,
  imports: [BadgeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="border border-line bg-surface p-5 flex flex-col gap-4"
      aria-labelledby="seo-quota-heading"
      data-testid="seo-quota-readout"
    >
      <h2
        id="seo-quota-heading"
        class="text-xs tracking-widest uppercase text-ink-muted font-normal"
      >
        Quota
      </h2>

      @if (loading()) {
        <app-skeleton height="4rem" />
      } @else if (quota(); as q) {
        <dl class="grid gap-3 sm:grid-cols-3" data-testid="seo-quota-cells">
          <!-- Bing -->
          <div class="border border-line p-3 flex flex-col gap-2">
            <dt class="flex items-center gap-2">
              <span class="text-xs tracking-widest uppercase text-ink-muted">Bing submit</span>
              <app-badge
                [tone]="tone(q.bing.state)"
                [ariaLabel]="'Bing quota: ' + label(q.bing.state)"
              >
                {{ label(q.bing.state) }}
              </app-badge>
            </dt>
            <dd class="m-0 text-sm text-ink">
              @if (q.bing.state === 'ok') {
                <span class="tabular-nums">{{ q.bing.dailyQuota ?? '—' }}</span>
                <span class="text-ink-muted text-xs"> / day</span>
                <span class="text-ink-muted text-xs tabular-nums">
                  · {{ q.bing.monthlyQuota ?? '—' }} / month</span
                >
              } @else {
                <span class="text-xs text-ink-muted">{{ q.bing.detail }}</span>
              }
            </dd>
          </div>

          <!-- GSC URL Inspection -->
          <div class="border border-line p-3 flex flex-col gap-2">
            <dt class="flex items-center gap-2">
              <span class="text-xs tracking-widest uppercase text-ink-muted">URL inspection</span>
              <app-badge
                [tone]="tone(q.gsc.state)"
                [ariaLabel]="'GSC inspect budget: ' + label(q.gsc.state)"
              >
                {{ label(q.gsc.state) }}
              </app-badge>
            </dt>
            <dd class="m-0 text-sm text-ink">
              @if (q.gsc.state === 'ok') {
                <span class="tabular-nums">{{ q.gsc.inspectUsed }}</span>
                <span class="text-ink-muted text-xs"> / {{ q.gsc.inspectCap }} used</span>
                <span class="text-ink-muted text-xs block">estimated</span>
              } @else {
                <span class="text-xs text-ink-muted">{{ q.gsc.detail }}</span>
              }
            </dd>
          </div>

          <!-- IndexNow -->
          <div class="border border-line p-3 flex flex-col gap-2">
            <dt class="text-xs tracking-widest uppercase text-ink-muted">IndexNow</dt>
            <dd class="m-0 text-sm text-ink">
              <span class="tabular-nums">{{ dedupMinutes(q.indexnow.dedupWindowSeconds) }}</span>
              <span class="text-ink-muted text-xs"> min dedup window</span>
            </dd>
          </div>
        </dl>
      } @else {
        <p class="text-xs text-ink-muted" data-testid="seo-quota-empty">Quota unavailable.</p>
      }
    </section>
  `,
})
export class SeoQuotaReadoutComponent {
  readonly quota = input<SeoQuota | null>(null);
  readonly loading = input(false);

  protected tone(state: SeoEngineReadState): BadgeTone {
    return READ_STATE_TONE[state] ?? 'neutral';
  }

  protected label(state: SeoEngineReadState): string {
    return READ_STATE_LABEL[state] ?? state;
  }

  protected dedupMinutes(seconds: number): number {
    return Math.round(seconds / 60);
  }
}
