import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LocaleService } from '../../locale.service';
import { APP_ROUTES } from '../../../lib/routes';
import { DEFAULT_LOGO } from '../../../lib/no-image';

/** One lockup for both locales: the wordmark is Latin script, so there
 * is no per-locale artwork to choose between. Lockup b per brand floor §4.5. */
const LOCKUP_SRC = DEFAULT_LOGO;

@Component({
  selector: 'app-auth-page-shell',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="shell" [attr.data-testid]="testId()" aria-labelledby="auth-shell-heading">
      <a class="brand-link" [routerLink]="homeHref()" [attr.aria-label]="strings().brand.name">
        <img
          [src]="lockupSrc"
          [alt]="strings().header.brandLockupAlt"
          width="162"
          height="44"
          class="lockup"
          loading="eager"
          decoding="sync"
          fetchpriority="high"
        />
      </a>
      <header class="head">
        <h1 id="auth-shell-heading" class="heading">{{ heading() }}</h1>
        @if (subheading()) {
          <p class="subheading">{{ subheading() }}</p>
        }
      </header>
      <div class="body">
        <ng-content></ng-content>
      </div>
      @if (hasFooter()) {
        <footer class="foot">
          <ng-content select="[shellFooter]"></ng-content>
        </footer>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        background-color: var(--brand-bg);
      }
      .shell {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        max-inline-size: 480px;
        margin-inline: auto;
        padding-block: clamp(2rem, 8vh, 4rem);
        padding-inline: clamp(1rem, 5vw, 2rem);
        min-block-size: 100dvh;
      }
      .brand-link {
        align-self: flex-start;
        text-decoration: none;
      }
      .brand-link:focus-visible {
        outline: 2px solid var(--brand-focus);
        outline-offset: 2px;
        border-radius: var(--brand-radius-md);
      }
      .lockup {
        block-size: auto;
      }
      .head {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .heading {
        margin: 0;
        font-family: var(
          --brand-font-display
        ); /* agent_docs/storefront/brand-tokens.md page title */
        font-size: var(--brand-text-display);
        font-weight: 700;
        color: var(--brand-text);
      }
      .subheading {
        margin: 0;
        font-size: var(--brand-text-body);
        color: var(--brand-text-muted);
      }
      .body {
        display: block;
      }
      .foot {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-block-start: 1rem;
        font-size: var(--brand-text-body);
      }
    `,
  ],
})
export class AuthPageShellComponent {
  readonly heading = input.required<string>();
  readonly subheading = input<string>('');
  readonly hasFooter = input<boolean>(true);
  readonly testId = input<string>('auth-page-shell');

  private readonly locale = inject(LocaleService);
  protected readonly strings = this.locale.strings;
  protected readonly homeHref = computed(() => APP_ROUTES.home(this.locale.locale()));
  protected readonly lockupSrc = LOCKUP_SRC;
}
