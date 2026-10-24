import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import {
  ButtonComponent,
  HeadingComponent,
  openAssetPicker,
  type AssetPickerResult,
} from '@admin-ui';

/**
 * `/dev/asset-picker` — host page for the asset-picker primitive.
 *
 * The picker has no consumer until S18 (product picker) and S19 (category +
 * section pickers). This page exists so the e2e journey spec can drive the
 * picker against the live backend at every viewport, exercising the full
 * grid + filter + select round trip without coupling to any feature route.
 *
 * Authenticated route — sits inside the AppShell auth tree so `AssetsService`
 * carries the bearer token via the standard interceptor stack.
 */
@Component({
  selector: 'app-dev-asset-picker-host',
  standalone: true,
  imports: [ButtonComponent, DialogModule, HeadingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6 md:p-10 flex flex-col gap-6" data-testid="dev-asset-picker-host">
      <header>
        <p class="text-xs tracking-widest uppercase text-ink-muted">Dev</p>
        <app-heading [level]="1" scale="display">Asset picker host</app-heading>
        <p class="mt-3 text-sm text-ink-muted max-w-xl">
          Drives the
          <code class="font-mono text-ink">openAssetPicker</code> primitive against the live API. No
          consumer wiring until S18.
        </p>
      </header>

      <div class="flex items-center gap-3 flex-wrap">
        <app-button variant="primary" (clicked)="open('single')" testId="dev-open-single">
          Open · single-select
        </app-button>
        <app-button variant="secondary" (clicked)="open('multi')" testId="dev-open-multi">
          Open · multi-select
        </app-button>
      </div>

      <pre
        class="bg-surface-elevated border border-line p-4 text-xs text-ink font-mono tabular-nums overflow-x-auto"
        data-testid="dev-result"
        aria-live="polite"
      ><code>{{ printed() }}</code></pre>
    </section>
  `,
})
export class AssetPickerHostPage {
  private readonly dialog = inject(Dialog);
  protected readonly result = signal<AssetPickerResult | null>(null);

  protected printed(): string {
    const r = this.result();
    if (!r) return '(no selection yet)';
    if (r.kind === 'cancel') return 'cancel';
    if (r.kind === 'select-single') return `select-single:${r.asset.id}`;
    return `select-multi:${r.assets.map((a) => a.id).join(',')}`;
  }

  protected async open(mode: 'single' | 'multi'): Promise<void> {
    const r = await openAssetPicker(this.dialog, { mode });
    this.result.set(r);
  }
}
