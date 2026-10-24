import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import {
  BadgeComponent,
  ButtonComponent,
  DropzoneComponent,
  FormFieldComponent,
  HeadingComponent,
  IconComponent,
  InputComponent,
  KpiCardComponent,
  LabelComponent,
  LinkComponent,
  RichTextEditorComponent,
  SkeletonComponent,
  SparklineComponent,
  SpinnerComponent,
  TabStripComponent,
  TextareaComponent,
  TranslatableInputComponent,
  openConfirmDialog,
  type DropzoneFileRejection,
  type TabStripItem,
  type TranslatableValue,
} from '@admin-ui';
import { Bell, CheckCircle2, Package, TrendingUp } from 'lucide-angular';

/**
 * Design-system showcase. Static, unauthenticated, no guards. Accessible at
 * /dev/design-system — used for brand audits, accessibility audits, and as
 * the target for our responsive / visual regression tests.
 *
 * One page per primitive group to keep the route self-contained.
 */
@Component({
  selector: 'app-design-system-page',
  standalone: true,
  imports: [
    BadgeComponent,
    ButtonComponent,
    DialogModule,
    DropzoneComponent,
    FormFieldComponent,
    FormsModule,
    HeadingComponent,
    JsonPipe,
    IconComponent,
    InputComponent,
    KpiCardComponent,
    LabelComponent,
    LinkComponent,
    ReactiveFormsModule,
    RichTextEditorComponent,
    SkeletonComponent,
    SparklineComponent,
    SpinnerComponent,
    TabStripComponent,
    TextareaComponent,
    TranslatableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="min-h-screen bg-surface text-ink" data-testid="design-system-page">
      <header class="border-b border-line px-6 py-8 md:px-10 md:py-12">
        <p class="text-ink-disabled text-xs tracking-widest uppercase">Design System</p>
        <app-heading [level]="1" scale="display">Badii · primitives</app-heading>
        <p class="mt-4 text-ink-disabled max-w-xl tabular">
          Every atom and organism the admin dashboard ships with. Brutalist, monochrome,
          zero-radius, brand-token-compliant.
        </p>
      </header>

      <div class="px-6 py-10 md:px-10 md:py-16 space-y-20">
        <!-- Buttons -->
        <section data-testid="demo-buttons">
          <app-heading [level]="2">Button</app-heading>
          <div class="mt-6 flex flex-wrap gap-4 items-start">
            <app-button variant="primary">Primary</app-button>
            <app-button variant="secondary">Secondary</app-button>
            <app-button variant="destructive">Destructive</app-button>
            <app-button variant="ghost">Ghost</app-button>
          </div>
          <div class="mt-4 flex flex-wrap gap-4 items-start">
            <app-button size="sm">Small</app-button>
            <app-button size="md">Medium</app-button>
            <app-button size="lg">Large</app-button>
          </div>
          <div class="mt-4 flex flex-wrap gap-4 items-start">
            <app-button [disabled]="true">Disabled</app-button>
            <app-button [loading]="true">Loading</app-button>
          </div>
        </section>

        <!-- Form controls -->
        <section data-testid="demo-forms">
          <app-heading [level]="2">Form controls</app-heading>
          <div class="mt-6 grid md:grid-cols-2 gap-8 max-w-4xl">
            <app-form-field
              fieldId="email"
              label="Email"
              hint="Store contact email"
              [required]="true"
            >
              <app-input
                id="email"
                type="email"
                [ngModel]="email()"
                (ngModelChange)="email.set($event)"
              />
            </app-form-field>
            <app-form-field fieldId="slug" label="Slug" error="Slug is already taken">
              <app-input id="slug" [invalid]="true" [ngModel]="'demo-store'" />
            </app-form-field>
            <app-form-field fieldId="bio" label="Biography">
              <app-textarea id="bio" [rows]="4" placeholder="Tell customers who you are." />
            </app-form-field>
            <app-form-field fieldId="disabled" label="Disabled">
              <app-input id="disabled" [ngModel]="''" />
              <div class="mt-2">
                <app-label [for]="'static'">Static label</app-label>
              </div>
            </app-form-field>
          </div>
        </section>

        <!-- Badges -->
        <section data-testid="demo-badges">
          <app-heading [level]="2">Badge</app-heading>
          <div class="mt-6 flex flex-wrap gap-3">
            <app-badge tone="neutral">Draft</app-badge>
            <app-badge tone="success">Shipped</app-badge>
            <app-badge tone="warning">Attention</app-badge>
            <app-badge tone="error">Failed</app-badge>
            <app-badge tone="info">Info</app-badge>
          </div>
        </section>

        <!-- Loading -->
        <section data-testid="demo-loading">
          <app-heading [level]="2">Loading</app-heading>
          <div class="mt-6 flex flex-wrap gap-6 items-center">
            <app-spinner [size]="16" label="Loading orders" />
            <app-spinner [size]="24" label="Loading orders" />
            <app-spinner [size]="32" label="Loading orders" />
          </div>
          <div class="mt-8 space-y-3 max-w-md">
            <app-skeleton height="2rem" width="60%" />
            <app-skeleton height="1rem" />
            <app-skeleton height="1rem" width="80%" />
          </div>
        </section>

        <!-- Typography -->
        <section data-testid="demo-typography">
          <app-heading [level]="2">Typography</app-heading>
          <div class="mt-6 space-y-4">
            <app-heading [level]="1" scale="display">Display / Badii</app-heading>
            <app-heading [level]="2" scale="section">Section header</app-heading>
            <app-heading [level]="3" scale="subsection">Subsection</app-heading>
            <app-heading [level]="4" scale="eyebrow">Eyebrow</app-heading>
            <p class="text-ink max-w-xl">
              Body text. Ink on the surface, Satoshi fallback to system-ui. Every number in the
              dashboard uses JetBrains Mono —
              <span class="tabular">$12,430.00</span>, <span class="tabular">2026-04-15</span>,
              <span class="tabular">req-9af02c3f</span>.
            </p>
          </div>
        </section>

        <!-- Links -->
        <section data-testid="demo-links">
          <app-heading [level]="2">Link</app-heading>
          <div class="mt-6 flex flex-wrap gap-6">
            <app-link to="/dev/design-system">Internal (hover underline)</app-link>
            <app-link to="/dev/design-system" underline="always">Always underlined</app-link>
            <app-link href="https://badii.studio" [external]="true">External</app-link>
          </div>
        </section>

        <!-- Icon -->
        <section data-testid="demo-icon">
          <app-heading [level]="2">Icon</app-heading>
          <p class="mt-2 text-ink-disabled tabular text-sm max-w-xl">
            Lucide, stroke 1.75 px. Aria-hidden by default; pass
            <code class="font-mono text-ink">label</code> when the icon stands alone without a
            paired text label.
          </p>
          <div class="mt-6 flex flex-wrap gap-6 items-end">
            <app-icon [name]="icons.Bell" [size]="16" label="Notifications" />
            <app-icon [name]="icons.Package" [size]="20" />
            <app-icon [name]="icons.CheckCircle2" [size]="24" label="Saved" />
          </div>
        </section>

        <!-- KPI card + sparkline -->
        <section data-testid="demo-kpi">
          <app-heading [level]="2">KPI card + Sparkline</app-heading>
          <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <app-kpi-card
              label="Gross revenue"
              value="$12,430"
              [delta]="0.048"
              sublabel="vs. last 7 days"
              [trendPoints]="revenueTrend"
              tone="positive"
              testId="kpi-revenue"
            />
            <app-kpi-card
              label="Orders"
              value="238"
              [delta]="-0.02"
              sublabel="vs. last 7 days"
              [trendPoints]="ordersTrend"
              tone="negative"
              testId="kpi-orders"
            />
            <app-kpi-card label="Refunds" value="4" tone="neutral" testId="kpi-refunds" />
          </div>
          <div class="mt-8 flex items-center gap-6">
            <span class="text-xs tracking-widest uppercase text-ink-disabled">
              Standalone sparkline
            </span>
            <app-sparkline
              [values]="revenueTrend"
              [width]="200"
              [height]="40"
              ariaLabel="Revenue trend, last 7 days"
            />
          </div>
        </section>

        <!-- Tab strip -->
        <section data-testid="demo-tabstrip">
          <app-heading [level]="2">Tab strip</app-heading>
          <div class="mt-6">
            <app-tab-strip
              [tabs]="tabs"
              [active]="activeTab()"
              idPrefix="demo-tab"
              ariaLabel="Demo tabs"
              (tabChanged)="activeTab.set($event)"
            />
            <div role="tabpanel" class="mt-4 tabular text-sm text-ink-muted">
              Active tab: <span class="text-ink">{{ activeTab() }}</span>
            </div>
          </div>
        </section>

        <!-- Translatable input -->
        <section data-testid="demo-translatable">
          <app-heading [level]="2">Translatable input</app-heading>
          <p class="mt-2 text-ink-disabled tabular text-sm max-w-xl">
            Multi-locale text input bound to a Translatable JSONB field. Edits the active locale
            tab; the default locale is mirrored into the <code>default</code> key.
          </p>
          <div class="mt-6 grid md:grid-cols-2 gap-8 max-w-4xl">
            <app-form-field fieldId="name" label="Product name" [required]="true">
              <app-translatable-input
                [formControl]="translatableName"
                inputId="demo-name"
                idPrefix="demo-name"
                testId="demo-name"
              />
            </app-form-field>
            <app-form-field fieldId="desc" label="Description (multiline)">
              <app-translatable-input
                [formControl]="translatableDesc"
                [multiline]="true"
                [rows]="4"
                inputId="demo-desc"
                idPrefix="demo-desc"
                testId="demo-desc"
              />
            </app-form-field>
          </div>
          <pre
            class="mt-4 text-xs tabular text-ink-disabled overflow-x-auto"
            data-testid="demo-translatable-json"
            >{{ translatableName.value | json }}</pre
          >
        </section>

        <!-- Rich text editor -->
        <section data-testid="demo-richtext">
          <app-heading [level]="2">Rich text editor</app-heading>
          <p class="mt-2 text-ink-disabled tabular text-sm max-w-xl">
            Sanitised HTML bound via ControlValueAccessor. Toolbar allows bold, italic, lists,
            links, and headings 1–4. Sanitiser runs on blur via
            <code class="font-mono text-ink">sanitizeRichTextHtml</code>.
          </p>
          <div class="mt-6 max-w-3xl">
            <app-form-field fieldId="rte" label="CMS body">
              <app-rich-text-editor [formControl]="richHtml" inputId="demo-rte" testId="demo-rte" />
            </app-form-field>
          </div>
        </section>

        <!-- Dropzone -->
        <section data-testid="demo-dropzone">
          <app-heading [level]="2">Dropzone</app-heading>
          <p class="mt-2 text-ink-disabled tabular text-sm max-w-xl">
            Click or drag-drop to upload. Emits
            <code class="font-mono text-ink">filesAdded</code> + rejections with a typed reason
            (MIME, size, or count).
          </p>
          <div class="mt-6 max-w-xl">
            <app-dropzone
              accept="image/png,image/jpeg"
              [maxSizeBytes]="2 * 1024 * 1024"
              primaryLabel="Drop product images"
              hint="PNG or JPEG, up to 2 MB each."
              testId="demo-dropzone"
              (filesAdded)="onFilesAdded($event)"
              (filesRejected)="onFilesRejected($event)"
            />
            <p
              class="mt-3 tabular text-xs text-ink-disabled"
              aria-live="polite"
              data-testid="demo-dropzone-status"
            >
              {{ dropzoneStatus() }}
            </p>
          </div>
        </section>

        <!-- Dialog -->
        <section data-testid="demo-dialog">
          <app-heading [level]="2">Dialog</app-heading>
          <div class="mt-6 flex flex-wrap gap-4">
            <app-button (clicked)="openNeutral()">Open confirm</app-button>
            <app-button variant="destructive" (clicked)="openDestructive()">Destructive</app-button>
            <p
              class="tabular text-xs text-ink-disabled"
              data-testid="dialog-result"
              aria-live="polite"
            >
              Last action: {{ lastResult() ?? 'none' }}
            </p>
          </div>
        </section>
      </div>

      <footer class="border-t border-line px-6 py-6 md:px-10">
        <span class="text-ink-disabled text-xs tabular">badii.studio · Built to ship.</span>
      </footer>
    </main>
  `,
})
export class DesignSystemPage {
  private readonly dialog = inject(Dialog);

  readonly email = signal<string>('owner@example.com');
  readonly lastResult = signal<string | null>(null);

  readonly icons = { Bell, CheckCircle2, Package, TrendingUp };

  readonly revenueTrend: readonly number[] = [20, 26, 22, 31, 28, 34, 42];
  readonly ordersTrend: readonly number[] = [54, 48, 55, 50, 46, 52, 49];

  readonly tabs: readonly TabStripItem[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Activity', badge: '3' },
    { value: 'settings', label: 'Settings' },
  ];
  readonly activeTab = signal<string>('overview');

  readonly translatableName = new FormControl<TranslatableValue>(
    { default: 'Fraise dentaire' },
    { nonNullable: true },
  );
  readonly translatableDesc = new FormControl<TranslatableValue>(
    { default: 'Soft, breathable upper with a cushioned footbed.' },
    { nonNullable: true },
  );

  readonly richHtml = new FormControl<string>(
    '<p>Start typing — <strong>bold</strong>, <em>italic</em>, lists, headings.</p>',
    { nonNullable: true },
  );

  readonly dropzoneStatus = signal<string>('No files yet.');

  onFilesAdded(files: File[]): void {
    const names = files.map((f) => f.name).join(', ');
    this.dropzoneStatus.set(`Accepted ${files.length}: ${names}`);
  }

  onFilesRejected(rejections: DropzoneFileRejection[]): void {
    const msg = rejections.map((r) => `${r.file.name} (${r.reason})`).join('; ');
    this.dropzoneStatus.set(`Rejected: ${msg}`);
  }

  async openNeutral(): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Save changes?',
      body: 'These changes will be applied immediately.',
      confirmLabel: 'Save',
      cancelLabel: 'Cancel',
    });
    this.lastResult.set(ok ? 'confirmed' : 'cancelled');
  }

  async openDestructive(): Promise<void> {
    const ok = await openConfirmDialog(this.dialog, {
      title: 'Delete product?',
      body: 'This action cannot be undone.',
      tone: 'destructive',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    this.lastResult.set(ok ? 'deleted' : 'kept');
  }
}
