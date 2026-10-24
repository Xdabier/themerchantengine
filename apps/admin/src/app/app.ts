import { Component, DOCUMENT, effect, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { getLocaleDefinition } from '@common/locale';
import { AuthStore } from './core/stores/auth.store';

@Component({
  imports: [RouterModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = 'merchants-engine · admin';
  private readonly authStore = inject(AuthStore);
  private readonly document = inject(DOCUMENT);

  constructor() {
    effect(() => {
      const root = this.document.documentElement;
      const locale = this.authStore.locale();
      root.lang = locale;
      root.dir = getLocaleDefinition(locale)?.direction ?? 'ltr';
    });
  }
}
