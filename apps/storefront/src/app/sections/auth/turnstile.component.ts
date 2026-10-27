import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  output,
  signal,
  viewChild,
} from '@angular/core';

/**
 * Cloudflare Turnstile widget (2026-06-23) — bot defense on the register form.
 *
 * Renders ONLY when a public site key is configured at build time via
 * `VITE_TURNSTILE_SITE_KEY` (safe to bake — site keys are public). When the key
 * is absent (dev / local), the component is inert and `required` is false, so
 * the form submits without a token — matching the server captcha plugin, which
 * is itself gated on `TURNSTILE_SECRET`. Activate prod by setting BOTH.
 *
 * Browser-only: the Turnstile script + `render()` run inside `afterNextRender`,
 * so SSR emits nothing and hydration wires up the widget client-side. The token
 * is surfaced via the `token` output (null on expiry / error so the parent can
 * re-gate the submit button).
 */
interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: 'auto' | 'light' | 'dark';
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  reset: (id?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

@Component({
  selector: 'app-turnstile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (siteKey) {
      <div #host class="turnstile" data-testid="turnstile-widget"></div>
    }
  `,
  styles: [
    `
      .turnstile {
        min-block-size: 65px;
      }
    `,
  ],
})
export class TurnstileComponent {
  /** Emits the verification token on success, or null on expiry / error. */
  readonly token = output<string | null>();

  /** Public site key, baked at build time. Empty → the widget is inert. */
  protected readonly siteKey: string =
    (import.meta as unknown as { env?: Record<string, string> }).env?.['VITE_TURNSTILE_SITE_KEY'] ??
    '';

  /** True when a real token must be obtained before the form can submit. */
  get required(): boolean {
    return !!this.siteKey;
  }

  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private readonly widgetId = signal<string | null>(null);

  constructor() {
    afterNextRender(() => {
      if (!this.siteKey) return;
      void this.ensureScript().then(() => this.renderWidget());
    });
  }

  private ensureScript(): Promise<void> {
    if (window.turnstile) return Promise.resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_SRC}"]`);
    if (existing) {
      return new Promise((resolve) =>
        existing.addEventListener('load', () => resolve(), { once: true }),
      );
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.addEventListener('load', () => resolve(), { once: true });
      s.addEventListener('error', () => reject(new Error('turnstile script failed')), {
        once: true,
      });
      document.head.appendChild(s);
    });
  }

  private renderWidget(): void {
    const el = this.host()?.nativeElement;
    if (!el || !window.turnstile || this.widgetId()) return;
    const id = window.turnstile.render(el, {
      sitekey: this.siteKey,
      theme: 'auto',
      callback: (token) => this.token.emit(token),
      'expired-callback': () => this.token.emit(null),
      'error-callback': () => this.token.emit(null),
    });
    this.widgetId.set(id);
  }
}
