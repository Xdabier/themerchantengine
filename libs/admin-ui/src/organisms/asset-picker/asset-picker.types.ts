/**
 * Public type surface for the asset-picker primitive.
 *
 * Source-of-truth declarations live next to the component implementation
 * to keep the constructor parameter annotation (`data: AssetPickerOptions`)
 * resolvable from the same file at runtime — see the comment block in
 * `asset-picker.component.ts`. This module re-exports them so callers can
 * `import { type AssetPickerOptions } from '@admin-ui'` without reaching
 * into the component module directly.
 */
export type {
  AssetPickerFilter,
  AssetPickerOptions,
  AssetPickerResult,
} from './asset-picker.component';
