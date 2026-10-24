import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Minimal centered layout used by /auth/* routes (login, forgot, reset).
 * No sidebar, no topbar — just the brutalist surface backdrop and a
 * vertically-centered content column.
 */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main
      class="min-h-screen bg-surface text-ink flex items-center justify-center px-6 py-12"
      data-testid="auth-layout"
    >
      <div class="w-full max-w-md">
        <router-outlet></router-outlet>
      </div>
    </main>
  `,
})
export class AuthLayoutComponent {}
