import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Inject, Optional } from '@angular/core';
import { SidebarComponent, type NavGroup } from '@admin-ui';

export interface MobileNavDialogData {
  groups: NavGroup[];
}

/**
 * Thin wrapper around SidebarComponent so it can be hosted inside a CDK Dialog
 * with full-height positioning + backdrop + focus trap. Closes itself when any
 * nav item is clicked so the route change takes over.
 */
@Component({
  selector: 'app-mobile-nav-dialog',
  standalone: true,
  imports: [SidebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="w-80 max-w-[85vw] h-full bg-surface border-r border-line">
      <app-sidebar [groups]="data?.groups ?? []" (navItemClicked)="close()" />
    </div>
  `,
})
export class MobileNavDialogComponent {
  constructor(
    private readonly ref: DialogRef<void>,
    @Optional() @Inject(DIALOG_DATA) public readonly data: MobileNavDialogData | null,
  ) {}

  close(): void {
    this.ref.close();
  }
}
