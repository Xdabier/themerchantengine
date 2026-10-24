import type { CampaignSegment } from '@admin-services';
import { humanizeCode } from '../../shared/format/enum-label';

/**
 * Curated audience-segment labels. Mirrors the editor `<select>` option labels
 * so the same segment reads identically wherever it surfaces (list, badge,
 * send-confirmation dialog). Unknown codes fall back to {@link humanizeCode}.
 */
const SEGMENT_LABELS: Partial<Record<CampaignSegment, string>> = {
  ALL_CONFIRMED: 'All confirmed subscribers',
  NEW: 'New customers',
  ACTIVE: 'Active customers',
  LOYAL: 'Loyal customers',
  AT_RISK: 'At-risk customers',
  CHURNED: 'Churned customers',
  LAPSED: 'Lapsed customers',
};

/** Friendly label for the `CampaignSegment` enum. */
export function segmentLabel(segment: CampaignSegment | string | null | undefined): string {
  if (segment == null) return '—';
  return SEGMENT_LABELS[segment as CampaignSegment] ?? humanizeCode(segment);
}

/** Friendly label for the campaign `kind` enum (BROADCAST → "Broadcast", WINBACK → "Win-back"). */
export function kindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'BROADCAST':
      return 'Broadcast';
    case 'WINBACK':
      return 'Win-back';
    default:
      return humanizeCode(kind);
  }
}

/** Friendly label for the campaign `status` enum (e.g. SCHEDULED → "Scheduled"). */
export function campaignStatusLabel(status: string | null | undefined): string {
  return humanizeCode(status);
}

/** Friendly label for a subscriber's `source` (e.g. "newsletter-footer" → "Footer form"). */
export function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'newsletter-footer':
      return 'Footer form';
    case 'checkout':
      return 'Checkout';
    case 'import':
      return 'Imported';
    case 'admin':
      return 'Added by admin';
    default:
      return humanizeCode(source);
  }
}
