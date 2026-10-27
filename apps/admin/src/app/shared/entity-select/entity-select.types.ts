import type { Observable } from 'rxjs';

/** One row the picker can offer. `value` carries whatever the caller needs back. */
export interface EntityOption<T = unknown> {
  id: string;
  label: string;
  sublabel?: string;
  value: T;
}

export interface EntitySelectPage<T = unknown> {
  options: EntityOption<T>[];
  /** Server-side match count, so the picker can say how much it is not showing. */
  total: number;
}

/**
 * The contract `app-entity-select` codes against. Feature code builds a source
 * from a `libs/admin-services` service; the component never injects a service
 * itself, which is what keeps it usable from any module.
 *
 * Plan F (F8, zone lookups) reuses this contract instead of building a second
 * lookup. See `specs/features/admin-qa-remediation/plan-c-dead-controls.md` D2.
 */
export interface EntitySelectSource<T = unknown> {
  /** `page` is 1-based. The source owns its page size. */
  search(term: string, page: number): Observable<EntitySelectPage<T>>;
  /** Turn already-selected ids into labels, for edit flows. */
  resolve?(ids: readonly string[]): Observable<EntityOption<T>[]>;
}
