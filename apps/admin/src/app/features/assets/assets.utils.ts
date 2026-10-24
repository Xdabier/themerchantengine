import type { BadgeTone } from '@admin-ui';
import type { AssetStatus, AssetType } from '@admin-services';
import { humanizeCode } from '../../shared/format/enum-label';
import { pickTranslation, type Translatable } from '@admin-types';

export function assetStatusTone(status: AssetStatus | undefined): BadgeTone {
  switch (status) {
    case 'READY':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'PROCESSING':
      return 'warning';
    case 'PENDING':
      return 'info';
    default:
      return 'neutral';
  }
}

/** Friendly label for the `AssetStatus` enum (e.g. PROCESSING → "Processing"). */
export function assetStatusLabel(status: AssetStatus | string | null | undefined): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'PROCESSING':
      return 'Processing';
    case 'READY':
      return 'Ready';
    case 'FAILED':
      return 'Failed';
    default:
      return humanizeCode(status);
  }
}

export function assetTypeLabel(type: AssetType | undefined): string {
  switch (type) {
    case 'IMAGE':
      return 'Image';
    case 'VIDEO':
      return 'Video';
    case 'AUDIO':
      return 'Audio';
    case 'DOCUMENT':
      return 'Document';
    default:
      return 'Unknown';
  }
}

export function isVideo(asset: { type?: AssetType; mimeType?: string }): boolean {
  if (asset.type === 'VIDEO') return true;
  return asset.mimeType?.startsWith('video/') ?? false;
}

export function isImage(asset: { type?: AssetType; mimeType?: string }): boolean {
  if (asset.type === 'IMAGE') return true;
  return asset.mimeType?.startsWith('image/') ?? false;
}

/** Reads the size in bytes from whichever field the caller populated. */
export function bytesOf(asset: { fileSize?: number; bytes?: number }): number | null {
  const value = asset.fileSize ?? asset.bytes;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(n >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDimensions(
  asset: { width?: number | null; height?: number | null } | null | undefined,
): string {
  if (!asset || !asset.width || !asset.height) return '—';
  return `${asset.width}×${asset.height}`;
}

/**
 * Alt text in the operator's locale. `locale` is required rather than
 * defaulted so the compiler names every call site: the previous version read
 * `en` first and rendered English no matter which locale was selected.
 */
export function assetAltText(
  asset: { alt?: unknown; id: string },
  locale: string,
  defaultLocale: string,
): string {
  return pickTranslation(
    asset.alt as Translatable | string | null | undefined,
    locale,
    '',
    defaultLocale,
  );
}
