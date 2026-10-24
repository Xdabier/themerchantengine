import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

/**
 * Locale-agnostic /404 — direct hits where the locale segment is missing or
 * invalid (`/404`, `/zz/foo` after Nitro fallback). The locale-scoped 404
 * surface at `[locale]/[...not-found].page.ts` covers `/<locale>/<unknown>`.
 *
 * Renders bilingual stacked content because locale resolution failed. No
 * API client injected — must render fully server-side without network.
 */
@Component({
  selector: 'app-not-found-root-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="frame" aria-labelledby="not-found-heading-fr not-found-heading-en">
      <div class="block" lang="fr">
        <h1 id="not-found-heading-fr" class="heading">Page introuvable</h1>
        <p class="body">Cette page n'existe pas ou a été déplacée. Revenez à l'accueil.</p>
        <a class="cta" href="/fr/">Retour à l'accueil</a>
      </div>
      <div class="block" lang="en">
        <h1 id="not-found-heading-en" class="heading">Page not found</h1>
        <p class="body">The page you requested isn't available. Head back to the homepage.</p>
        <a class="cta" href="/en/">Back to home</a>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-bg);
        color: var(--brand-text);
        min-block-size: 100dvh;
      }
      .frame {
        max-inline-size: 720px;
        margin-inline: auto;
        padding-block: clamp(3rem, 8vw, 6rem);
        padding-inline: clamp(1rem, 4vw, 2rem);
        display: flex;
        flex-direction: column;
        gap: 2.5rem;
      }
      .block {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        text-align: start;
      }
      .heading {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));
        font-weight: 700;
        color: var(--brand-text);
        line-height: 1.2;
      }
      .body {
        margin: 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text-muted);
      }
      .cta {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 48px;
        min-inline-size: 44px;
        padding-inline: 1.5rem;
        padding-block: 0.75rem;
        font: inherit;
        font-weight: 600;
        color: var(--brand-on-primary);
        background-color: var(--brand-primary);
        border-radius: var(--brand-radius-md);
        text-decoration: none;
        align-self: flex-start;
      }
      .cta:hover,
      .cta:focus-visible {
        background-color: var(--brand-primary-dark);
      }
      .cta:focus-visible {
        outline: 2px solid var(--brand-text);
        outline-offset: 3px;
      }
    `,
  ],
})
export default class NotFoundRootPage implements OnInit, OnDestroy {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  ngOnInit(): void {
    this.title.setTitle('Page introuvable · Page not found');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }

  ngOnDestroy(): void {
    this.meta.removeTag('name="robots"');
  }
}
