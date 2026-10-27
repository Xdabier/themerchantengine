/**
 * Carrier tracking deep links.
 *
 * Lived as a private const inside the account order-detail page until plan M
 * phase M3 gave the public track page the same shipments list. Two copies of a
 * URL table drift the moment one carrier is added, so there is one.
 */
const CARRIER_BASE_URL: Record<string, string> = {
  DHL: 'https://www.dhl.com/en/express/tracking.html?AWB=',
  FEDEX: 'https://www.fedex.com/fedextrack/?trknbr=',
  ARAMEX: 'https://www.aramex.com/track/results?ShipmentNumber=',
};

/**
 * The carrier's own tracking URL for a shipment, or null when either half is
 * missing or the carrier is not one we hold a link for. Null means "render no
 * link", never "render a broken one".
 */
export function carrierTrackingUrl(
  carrier: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  if (!carrier || !trackingNumber) return null;
  const base = CARRIER_BASE_URL[carrier.toUpperCase()];
  if (!base) return null;
  return base + encodeURIComponent(trackingNumber);
}
