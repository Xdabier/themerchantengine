// Canary fixture. Never routed.
import { Component } from '@angular/core';

@Component({
  selector: 'app-allowed-page',
  template: `
    <th class="text-start ms-2">Name</th>
    <td class="text-end pe-4">{{ total() }}</td>
    <span class="absolute start-0 end-4">badge</span>
    <!-- innerhtml-approved: rich text sanitized on write, the one legitimate use. -->
    <div [innerHTML]="richText()"></div>
  `,
  styles: [
    `
      .cell {
        margin-inline-start: 1rem;
        border-inline-end: 1px solid var(--color-line);
        color: var(--color-ink);
      }
    `,
  ],
})
export class AllowedPage {
  total(): string {
    return '0';
  }

  richText(): string {
    return '<p>sanitized on write</p>';
  }
}
