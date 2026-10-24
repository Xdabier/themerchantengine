import type { BadgeTone } from '@admin-ui';
import type { WebhookDelivery } from '@admin-services';

export interface DeliveryStatusBadge {
  tone: BadgeTone;
  label: string;
}

/**
 * Derives a UI status badge from a Prisma `WebhookDelivery` row. The backend
 * has no `status` column — state is encoded in the presence of `succeededAt`,
 * `failedAt`, and `nextRetryAt`. See `apps/api/src/modules/webhooks/webhooks.service.ts`
 * `recordDeliverySuccess` / `recordDeliveryFailure` / `scheduleRetry`.
 */
export function deliveryStatusBadge(
  delivery: Pick<WebhookDelivery, 'succeededAt' | 'failedAt' | 'nextRetryAt'>,
): DeliveryStatusBadge {
  if (delivery.succeededAt) return { tone: 'success', label: 'Succeeded' };
  if (delivery.failedAt && delivery.nextRetryAt) {
    return { tone: 'warning', label: 'Retrying' };
  }
  if (delivery.failedAt) return { tone: 'error', label: 'Failed' };
  return { tone: 'neutral', label: 'Pending' };
}
