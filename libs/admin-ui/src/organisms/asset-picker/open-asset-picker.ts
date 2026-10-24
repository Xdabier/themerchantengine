import type { Dialog } from '@angular/cdk/dialog';
import {
  AssetPickerComponent,
  type AssetPickerOptions,
  type AssetPickerResult,
} from './asset-picker.component';

/**
 * Helper-side counter — backs the synthesized `titleId` when the caller
 * does not supply one. Distinct from the component-side counter in
 * `asset-picker.component.ts` (which prefixes per-card option ids); the
 * two never need to align because the helper always passes the
 * `titleId` it generates here through `data.titleId`, and the component
 * honours it. A direct `dialog.open(AssetPickerComponent, ...)` call
 * that bypasses this helper would fall back to the component's own
 * counter for the heading id.
 */
let assetPickerInstanceCounter = 0;

/**
 * Service-style helper wrapping CDK Dialog for the brand-styled asset
 * picker. Mirrors `openConfirmDialog` for pattern parity. Always resolves
 * with an `AssetPickerResult` discriminated union — never `undefined` —
 * so callers can `switch` on `result.kind` without null checks.
 */
export function openAssetPicker(
  dialog: Dialog,
  options: AssetPickerOptions,
): Promise<AssetPickerResult> {
  const instance = ++assetPickerInstanceCounter;
  const titleId = options.titleId ?? `asset-picker-${instance}-title`;
  // ARIA 1.2 §6.2.8: when both `aria-labelledby` and `aria-label` are
  // present, the labelledby reference wins and the label is silently
  // dropped — but some ATs announce both, producing a doubled name.
  // The `<h2 [id]="titleId">` inside the dialog is the canonical label
  // source, so only `ariaLabelledBy` is set here.
  const ref = dialog.open<AssetPickerResult>(AssetPickerComponent, {
    data: { ...options, titleId },
    backdropClass: 'cdk-overlay-backdrop-brand',
    panelClass: 'cdk-overlay-panel-brand',
    role: 'dialog',
    ariaModal: true,
    ariaLabelledBy: titleId,
    hasBackdrop: true,
    disableClose: false,
  });
  return new Promise((resolve) => {
    const sub = ref.closed.subscribe((value) => {
      resolve(value ?? { kind: 'cancel' });
      setTimeout(() => sub.unsubscribe(), 0);
    });
  });
}
