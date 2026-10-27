import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/stores/auth.store';

interface SettingsCard {
  path: string;
  title: string;
  description: string;
  permission: string;
}

/**
 * `/settings` — static navigation grid. Each card links to a focused
 * sub-screen; permissions determine whether a card is interactive
 * (links) or presentational (card still renders so operators see
 * what exists, but `aria-disabled` + no href when they lack access).
 */
@Component({
  selector: 'app-settings-home-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-8" data-testid="settings-home-page">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Configuration</p>
        <h1 class="mt-2 text-4xl md:text-5xl font-bold tracking-tight">Settings</h1>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Store-wide configuration. Changes propagate to every surface that reads the settings
          object.
        </p>
      </header>

      <ul
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        role="list"
        data-testid="settings-cards"
      >
        @for (card of cards; track card.path) {
          @if (canAccess(card.permission)) {
            <li>
              <a
                [routerLink]="card.path"
                class="block h-full border border-line p-5 hover:border-ink focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-2 motion-safe:transition-colors motion-safe:duration-75"
                [attr.data-testid]="'settings-card-' + card.path.split('/').pop()"
              >
                <h2 class="text-xs tracking-widest uppercase text-ink-muted">
                  {{ card.title }}
                </h2>
                <p class="mt-3 text-sm text-ink">{{ card.description }}</p>
              </a>
            </li>
          } @else {
            <li>
              <div
                role="group"
                class="block h-full border border-line p-5 opacity-50"
                aria-disabled="true"
                [attr.aria-label]="card.title + ' — requires ' + card.permission + ' permission'"
                [attr.data-testid]="'settings-card-disabled-' + card.path.split('/').pop()"
              >
                <h2 class="text-xs tracking-widest uppercase text-ink-muted">
                  {{ card.title }}
                </h2>
                <p class="mt-3 text-sm text-ink-muted">{{ card.description }}</p>
                <p class="mt-2 text-xs tabular text-status-warning">
                  Requires <code class="font-mono">{{ card.permission }}</code
                  >.
                </p>
              </div>
            </li>
          }
        }
      </ul>
    </section>
  `,
})
export class SettingsHomePage {
  private readonly authStore = inject(AuthStore);

  protected readonly cards: SettingsCard[] = [
    {
      path: '/settings/general',
      title: 'General',
      description: 'Store name and description, brand slug, legal entity, contact, timezone.',
      permission: 'settings:view',
    },
    {
      path: '/settings/brand',
      title: 'Brand',
      description: 'Base colours with a live palette preview, the font kit, the logo and favicon.',
      permission: 'settings:view',
    },
    {
      path: '/settings/money',
      title: 'Money',
      description: 'Currency and symbol, separators, display precision, tax display and VAT rate.',
      permission: 'settings:view',
    },
    {
      path: '/settings/domains',
      title: 'Domains',
      description: 'The storefront, admin and API origins the engine publishes links against.',
      permission: 'settings:view',
    },
    {
      path: '/settings/locales',
      title: 'Locales',
      description: 'Which languages the storefront offers + the default.',
      permission: 'settings:view',
    },
    {
      path: '/settings/appearance',
      title: 'Appearance',
      description: 'Logo, favicon. Theme is locked to the brand palette.',
      permission: 'settings:view',
    },
    {
      path: '/settings/integrations',
      title: 'Integrations',
      description: 'API keys for third-party services — analytics, email, SMS, Sentry.',
      permission: 'settings:manage',
    },
    {
      path: '/notifications/templates',
      title: 'Notification templates',
      description:
        'Per-flow email toggles, the template editor with live preview, the send log, and a global pause.',
      permission: 'notifications:view',
    },
    {
      path: '/campaigns',
      title: 'Campaigns & Subscribers',
      description:
        'Compose marketing broadcasts on an isolated queue, attach coupons, manage the newsletter audience.',
      permission: 'campaigns:view',
    },
    {
      path: '/settings/product-types',
      title: 'Product types',
      description: 'Catalog taxonomy: bundles of attributes shared by products of the same family.',
      permission: 'products:view',
    },
    {
      path: '/settings/attributes',
      title: 'Attributes',
      description:
        'Variant axes (size, colour, material) with typed values, scoped to a product type.',
      permission: 'products:view',
    },
  ];

  canAccess(permission: string): boolean {
    return this.authStore.hasAnyPermission([permission]);
  }
}
