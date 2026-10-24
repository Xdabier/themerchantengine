# `@storefront-services`

Angular `@Injectable` services that consume the storefront API. Each service injects an `ApiClient` token (server-bound or browser-bound depending on context) and parses every response through the matching `@storefront-types` Zod schema before returning data. Consumed by `apps/storefront/` server route loaders and client islands.

Run tests via `npx nx test storefront-services`.
