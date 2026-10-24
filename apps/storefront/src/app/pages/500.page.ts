import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

/**
 * Locale-agnostic /500 — fallback when SSR or a downstream API failure
 * surfaces before locale resolution succeeds. Renders bilingual stacked
 * content with zero API dependency: a downed API must not loop here.
 */
@Component({
  selector: 'app-server-error-root-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="frame" aria-labelledby="server-error-heading-fr server-error-heading-en">
      <div class="block" lang="fr">
        <h1 id="server-error-heading-fr" class="heading">Une erreur est survenue de notre côté</h1>
        <p class="body">Nous travaillons dessus. Réessayez dans un instant.</p>
        <a class="cta" href="/fr/">Retour à l'accueil</a>
      </div>
      <div class="block" lang="en">
        <h1 id="server-error-heading-en" class="heading">Something went wrong on our end</h1>
        <p class="body">We're working on it. Try again in a moment.</p>
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
export default class ServerErrorRootPage implements OnInit, OnDestroy {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  ngOnInit(): void {
    this.title.setTitle('Erreur serveur · Server error');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }

  ngOnDestroy(): void {
    this.meta.removeTag('name="robots"');
  }
}
