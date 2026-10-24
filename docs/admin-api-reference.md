# Admin API reference

This file used to be a hand-written catalogue of every `/v1/admin/*` endpoint. It was last revised by hand on 2026-05-23 and had drifted from the controllers, so it was retired.

The reference is now generated from the code by `npm run docs:generate` and lives under `docs/site/reference/`:

- `docs/site/reference/admin-api/<module>.md`, one page per module, with every route, its parameters, request body, responses and schemas.
- `docs/site/reference/permissions.md`, every `<module>:<action>` permission and the routes that enforce it.
- `docs/site/reference/error-codes.md`, every error code the API answers with.
- `docs/site/reference/_generated/openapi.admin.json`, the OpenAPI document those pages render from.

The pages are published on themerchantengine.com in the reference track of the docs (under `/docs/reference/` for the latest release, and under the version segment for a pinned copy). CI regenerates the tree on every push and fails on a difference, so a page there is as current as the controllers. Comments in the code still cite this file by section name or by line number; every such citation refers to the module page of the same name under `docs/site/reference/admin-api/`, and the line numbers refer to the retired file, not to this pointer.
