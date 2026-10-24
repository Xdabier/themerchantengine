/** A node in any tree the section editors resolve ids against. */
interface IdNode {
  id: string;
  children?: readonly IdNode[];
}

/**
 * Flattens a category tree to the set of ids that currently exist.
 *
 * The set, rather than a list, because the only question asked of it is
 * membership: `deadIdValidator` tests whether a configured id is still real.
 */
export function collectLiveIds(nodes: readonly IdNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const visit = (list: readonly IdNode[]): void => {
    for (const node of list) {
      ids.add(node.id);
      visit(node.children ?? []);
    }
  };
  visit(nodes);
  return ids;
}
