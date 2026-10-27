import { Translatable } from '@common/interfaces';

// ── Notification types ────────────────────────────────────────────────────────

export enum NotificationType {
  NEW_ORDER = 'NEW_ORDER',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  NEW_REVIEW = 'NEW_REVIEW',
  RETURN_REQUESTED = 'RETURN_REQUESTED',
}

// ── Event → Notification type mapping ─────────────────────────────────────────

export const EVENT_NOTIFICATION_MAP: Record<string, NotificationType> = {
  'order.created': NotificationType.NEW_ORDER,
  'inventory.low_stock': NotificationType.LOW_STOCK,
  'inventory.out_of_stock': NotificationType.OUT_OF_STOCK,
  'review.created': NotificationType.NEW_REVIEW,
  'return.created': NotificationType.RETURN_REQUESTED,
};

// ── Notification templates ────────────────────────────────────────────────────

/**
 * In-app admin notifications. Shop staff read these in the dashboard, not
 * customers, so they carry no salutation and stay terse operational notices.
 * `default` and `en` are English; `fr` and `ar` are what operators in those
 * languages read. Prose fallbacks are per-locale so a line never carries a
 * clause from another language. A locale with no copy reads `default`.
 */
export const NOTIFICATION_TEMPLATES: Record<
  NotificationType,
  {
    title: Translatable;
    bodyTemplate?: (data: unknown) => Translatable;
  }
> = {
  [NotificationType.NEW_ORDER]: {
    title: { default: 'New Order', en: 'New Order', fr: 'Nouvelle commande', ar: 'طلب جديد' },
    bodyTemplate: (data: unknown) => {
      const order = data as { id?: string; orderNumber?: string } | undefined;
      const orderNum = order?.orderNumber ?? order?.id ?? 'N/A';
      return {
        default: `Order ${orderNum} has been placed`,
        en: `Order ${orderNum} has been placed`,
        fr: `Commande ${orderNum} passée`,
        ar: `تم تسجيل الطلب ${orderNum}`,
      };
    },
  },
  [NotificationType.LOW_STOCK]: {
    title: { default: 'Low Stock', en: 'Low Stock', fr: 'Stock bas', ar: 'مخزون منخفض' },
    bodyTemplate: (data: unknown) => {
      const variant = data as { sku?: string; quantity?: number } | undefined;
      const sku = variant?.sku ?? 'N/A';
      const qty = variant?.quantity ?? 0;
      return {
        default: `SKU ${sku} has ${qty} units remaining`,
        en: `SKU ${sku} has ${qty} units remaining`,
        fr: `SKU ${sku}, stock restant : ${qty}`,
        ar: `الكمية المتبقية من ${sku}: ${qty}`,
      };
    },
  },
  [NotificationType.OUT_OF_STOCK]: {
    title: {
      default: 'Out of Stock',
      en: 'Out of Stock',
      fr: 'Rupture de stock',
      ar: 'نفد المخزون',
    },
    bodyTemplate: (data: unknown) => {
      const variant = data as { sku?: string } | undefined;
      const sku = variant?.sku ?? 'N/A';
      return {
        default: `SKU ${sku} is now out of stock`,
        en: `SKU ${sku} is now out of stock`,
        fr: `SKU ${sku} en rupture de stock`,
        ar: `نفد مخزون ${sku}`,
      };
    },
  },
  [NotificationType.NEW_REVIEW]: {
    title: { default: 'New Review', en: 'New Review', fr: 'Nouvel avis', ar: 'تقييم جديد' },
    bodyTemplate: (data: unknown) => {
      const review = data as { productName?: string; rating?: number } | undefined;
      const rating = review?.rating ?? 0;
      const product = {
        en: review?.productName ?? 'A product',
        fr: review?.productName ?? 'Un produit',
        ar: review?.productName ?? 'منتج',
      };
      return {
        default: `${rating}/5 star review for ${product.en}`,
        en: `${rating}/5 star review for ${product.en}`,
        fr: `Avis ${rating}/5 sur ${product.fr}`,
        ar: `تقييم ${rating}/5 لـ ${product.ar}`,
      };
    },
  },
  [NotificationType.RETURN_REQUESTED]: {
    title: {
      default: 'Return Requested',
      en: 'Return Requested',
      fr: 'Retour demandé',
      ar: 'طلب إرجاع',
    },
    bodyTemplate: (data: unknown) => {
      const ret = data as { orderId?: string; reason?: string } | undefined;
      const reason = {
        en: ret?.reason ?? 'No reason provided',
        fr: ret?.reason ?? 'Motif non précisé',
        ar: ret?.reason ?? 'لم يذكر سبب',
      };
      return {
        default: `Customer requested return: ${reason.en}`,
        en: `Customer requested return: ${reason.en}`,
        fr: `Retour demandé par le client : ${reason.fr}`,
        ar: `طلب العميل إرجاعًا: ${reason.ar}`,
      };
    },
  },
};

// ── Pagination ────────────────────────────────────────────────────────────────

export const NOTIFICATIONS_DEFAULT_PAGE_SIZE = 20;
export const NOTIFICATIONS_MAX_PAGE_SIZE = 100;
