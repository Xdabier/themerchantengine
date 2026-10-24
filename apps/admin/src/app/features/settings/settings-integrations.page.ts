import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * `/settings/integrations`: a signpost, not an editor.
 *
 * This screen used to offer six credential fields and store none of them
 * (finding D5). `updateSettingsRequestSchema` models no `integrations` key, so
 * Zod stripped the whole request body, `SettingsService.update` PATCHed `{}`,
 * the API answered `200` with nothing changed, and the page rendered
 * "Integrations saved." An operator could set a GA4 measurement id here, see a
 * success message, reload, and find the field empty with no error anywhere.
 *
 * Wiring the six up was not an option:
 *
 * - `analyticsKey` duplicates a knob that already has a real editor. GA4, Meta,
 *   TikTok and Snap ids belong on `/analytics/pixels`, which stores them and
 *   which the storefront now reads. Two editors for one setting is how the two
 *   disagree.
 * - `emailApiKey`, `smsApiKey` and `stripeWebhookSecret` are provider secrets.
 *   Constitution §3.7 keeps secrets in environment variables, never in a
 *   database row an admin session can read back.
 * - `sentryDsn` and `stripePublishableKey` are deploy-time configuration for
 *   services that are not wired to this application at all.
 *
 * So the fields are gone and the page says where each thing actually lives.
 * `SettingsService.update` now throws when the schema empties a body, so no
 * future screen can report a save for a value that was never stored.
 */
@Component({
  selector: 'app-settings-integrations-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="p-6 md:p-10 flex flex-col gap-8 max-w-3xl"
      data-testid="settings-integrations-page"
    >
      <nav class="text-xs tracking-widest uppercase text-ink-muted" aria-label="Breadcrumb">
        <a
          routerLink="/settings"
          class="hover:text-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
        >
          Settings
        </a>
        <span aria-hidden="true" class="mx-2">/</span>
        <span class="text-ink" aria-current="page">Integrations</span>
      </nav>

      <header>
        <h1 class="text-3xl md:text-4xl font-bold tracking-tight">Integrations</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Nothing is configured from this screen. Each integration is set where it is actually read,
          which is what keeps one setting from having two editors that disagree.
        </p>
      </header>

      <dl class="flex flex-col gap-6">
        <div class="flex flex-col gap-2">
          <dt class="text-xs tracking-widest uppercase text-ink-muted">Analytics and pixels</dt>
          <dd class="text-sm text-ink">
            Google Analytics, Meta, TikTok and Snap ids are set on the pixel editor, and the
            storefront loads the tag for whichever you configure.
            <a
              routerLink="/analytics/pixels"
              class="tabular underline underline-offset-4 hover:text-ink-emphasis focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2"
              data-testid="settings-integrations-pixels-link"
            >
              Open tracking pixels
            </a>
          </dd>
        </div>

        <div class="flex flex-col gap-2">
          <dt class="text-xs tracking-widest uppercase text-ink-muted">Provider secrets</dt>
          <dd class="text-sm text-ink">
            Email, SMS and payment provider keys are deployment configuration and live in
            environment variables on the server, never in a database row an admin session could read
            back. Ask whoever owns the deploy to rotate one.
          </dd>
        </div>
      </dl>
    </section>
  `,
})
export class SettingsIntegrationsPage {}
