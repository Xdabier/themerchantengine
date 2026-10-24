import type { BadgeTone } from '@admin-ui';
import type { MerchandisingRuleType } from '@admin-services';

export interface TypeBadge {
  tone: BadgeTone;
  label: string;
}

/**
 * Maps a merchandising-rule Prisma enum value to a brand-compliant badge.
 * BOOST raises a product, BURY pushes it down, PIN fixes its position,
 * REDIRECT hijacks the query.
 */
export function merchandisingTypeBadge(type: MerchandisingRuleType): TypeBadge {
  switch (type) {
    case 'BOOST':
      return { tone: 'success', label: 'Boost' };
    case 'BURY':
      return { tone: 'warning', label: 'Bury' };
    case 'PIN':
      return { tone: 'info', label: 'Pin' };
    case 'REDIRECT':
      return { tone: 'neutral', label: 'Redirect' };
  }
}
