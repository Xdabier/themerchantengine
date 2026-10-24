/**
 * Event name emitted by `StorefrontConfigService` after any write that
 * mutates a `StorefrontSection` (create, update, delete, reorder, visibility
 * toggle). The `RevalidationListener` listens on this event and POSTs the
 * affected `pageSlug` paths to the storefront's `/api/_internal/revalidate`
 * route so SSG pages refresh.
 */
export const STOREFRONT_SECTION_UPDATED_EVENT = 'storefront.section_updated';

export interface StorefrontSectionUpdatedPayload {
  pageSlug: string;
}
