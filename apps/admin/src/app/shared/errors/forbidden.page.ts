import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forbidden-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen bg-surface text-ink flex items-center px-6 md:px-10">
      <div class="max-w-2xl">
        <p class="text-ink-muted text-xs tracking-widest uppercase">403</p>
        <h1 class="mt-2 text-5xl md:text-7xl font-bold tracking-tight">Access denied.</h1>
        <p class="mt-6 text-ink text-lg max-w-xl">
          You don't have permission to view this page. Ask a store owner to grant you the required
          role, or head back.
        </p>
        <a
          routerLink="/"
          class="mt-10 inline-block text-ink-emphasis text-sm tracking-widest uppercase border border-ink px-6 py-3 hover:bg-surface-emphasis hover:text-on-emphasis"
        >
          Back home
        </a>
      </div>
    </main>
  `,
})
export class ForbiddenPage {}
