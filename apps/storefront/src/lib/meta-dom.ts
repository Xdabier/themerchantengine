/**
 * Head-tag helpers for meta properties Angular's `Meta` service cannot manage.
 *
 * `Meta.updateTag` keeps a single node per selector, so a property the Open
 * Graph spec allows to repeat (`og:locale:alternate`) needs its own
 * clear-then-append pass. This lived as a private method on the product page,
 * which is why the product page was the only surface that ever emitted the
 * tag while four others computed the value and dropped it.
 */
export function upsertPropertyMulti(
  document: Document,
  property: string,
  contents: readonly string[],
): void {
  const head = document.head;
  if (!head) return;
  head
    .querySelectorAll<HTMLMetaElement>(`meta[property="${property}"]`)
    .forEach((node) => node.remove());
  for (const content of contents) {
    const tag = document.createElement('meta');
    tag.setAttribute('property', property);
    tag.setAttribute('content', content);
    head.appendChild(tag);
  }
}
