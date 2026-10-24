// Canary fixture. Never imported by application code.
export class BadService {
  list(query: { sortBy?: string }) {
    return { orderBy: { [query.sortBy ?? 'createdAt']: 'desc' } };
  }
}
