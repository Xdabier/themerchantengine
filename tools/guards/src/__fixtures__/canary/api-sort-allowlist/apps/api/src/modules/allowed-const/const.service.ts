// Canary fixture. Never imported by application code.
export const VALID_CONST_SORT_FIELDS = ['createdAt', 'name'] as const;

export class ConstService {
  list(query: { sortBy?: string }) {
    const sortBy = VALID_CONST_SORT_FIELDS.includes(
      query.sortBy as (typeof VALID_CONST_SORT_FIELDS)[number],
    )
      ? query.sortBy
      : 'createdAt';
    return { orderBy: { [sortBy as string]: 'desc' } };
  }
}
