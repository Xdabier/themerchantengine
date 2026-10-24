// Canary fixture. Never routed.
import { Component } from '@angular/core';

@Component({
  selector: 'app-second-binding-page',
  template: `
    <!-- innerhtml-approved: this one is reviewed and sanitized on write. -->
    <div [innerHTML]="approved()"></div>

    <p>filler</p>
    <p>filler</p>
    <p>filler</p>
    <p>filler</p>
    <p>filler</p>
    <p>filler</p>
    <p>filler</p>
    <p>filler</p>
    <p>filler</p>
    <p>filler</p>

    <div [innerHTML]="sneaked()"></div>
  `,
})
export class SecondBindingPage {
  approved(): string {
    return '<p>reviewed</p>';
  }

  sneaked(): string {
    return '<p>not reviewed</p>';
  }
}
