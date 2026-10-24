import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Component({
  selector: 'app-server-error-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen bg-surface text-ink flex items-center px-6 md:px-10">
      <div class="max-w-2xl">
        <p class="text-ink-muted text-xs tracking-widest uppercase">500</p>
        <h1 class="mt-2 text-5xl md:text-7xl font-bold tracking-tight">Something went wrong.</h1>
        <p class="mt-6 text-ink text-lg max-w-xl">
          The server couldn't complete your request. Engineering has been notified. If you contact
          support, include the correlation ID below.
        </p>

        @if (correlationId()) {
          <div class="mt-8 border border-line bg-surface-elevated p-4 max-w-xl">
            <p class="text-ink-muted text-xs tracking-widest uppercase">Correlation ID</p>
            <code class="mt-2 block text-ink tabular text-sm break-all">{{ correlationId() }}</code>
          </div>
        }

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
export class ServerErrorPage {
  private readonly route = inject(ActivatedRoute);
  readonly correlationId = toSignal(
    this.route.queryParams.pipe(map((q) => q['correlationId'] ?? null)),
    { initialValue: null },
  );
}
