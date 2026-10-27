# Captured wire fixtures

Unedited response bodies, committed so a schema spec can be checked against what
the API really sends rather than against a hand-built object that agrees with the
schema by construction.

A hand-built fixture is how the `priceMin` / `minPrice` drift survived: the only
`searchHitSchema` test in the tree parsed `{ product: { id, slug, name } }` and
asserted nothing threw, so it stayed green for as long as the field names were
wrong.

## v1-search-lampe.captured.json

- Endpoint: `GET /v1/search?q=lampe&page=1&pageSize=2`
- Header: `Accept-Language: fr`
- Origin: local dev API on port 53000, against whatever catalogue was seeded
- Captured: 2026-09-02
- Edits: `JSON.stringify(body, null, 2)` for a readable diff, and the asset
  bucket host rewritten to `assets.example.test`. The host is the one piece of
  the body that names an install rather than a shape, and no assertion reads
  it; everything the spec checks is field names, types and nesting.

Re-capture with:

```bash
curl -fsS -H 'Accept-Language: fr' \
  'http://localhost:53000/api/v1/search?q=lampe&page=1&pageSize=2' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))" \
  > libs/storefront-types/src/lib/search/__fixtures__/v1-search-lampe.captured.json
```

`search-wire.spec.ts` cross-checks this file against the `ProductSearchResult`
interface in `apps/api/src/modules/search/search.service.ts`, so a serializer
change makes the spec say the fixture is stale instead of quietly passing on a
capture from months ago.
