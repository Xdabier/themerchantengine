// Canary fixture. Never routed.
import { Component } from '@angular/core';

@Component({
  selector: 'app-bad-page',
  template: `
    <th class="text-left ml-2">Name</th>
    <td class="text-right pr-4">Total</td>
    <span class="absolute left-0 right-4">badge</span>
    <div [innerHTML]="raw()"></div>
  `,
  styles: [
    `
      .cell {
        margin-left: 1rem;
        border-right: 1px solid #ff0044;
        color: #ff004488;
      }
    `,
  ],
})
export class BadPage {
  raw(): string {
    return this.locale === 'fr' ? '<b>oui</b>' : '<b>yes</b>';
  }

  locale = 'en';
}
