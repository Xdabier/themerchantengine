# IndexNow key file — directory note

> **The IndexNow key file does not live here in production.**
>
> The pattern `apps/storefront/public/[a-f0-9]*.txt` is gitignored, so any
> file matching that shape never reaches the CI-built storefront image.
> Production serves the IndexNow verification file from a host-mounted
> overlay directory on the storefront edge nginx container. The operator
> runbook is `docs/site/operate/store-settings.md`, under rotating the
> search-engine credentials.

## Why the file isn't in this directory

The IndexNow protocol (per [DR-10](../../../specs/decision-records/10-indexnow-vs-gsc-submission.md)) verifies a submission's authenticity by fetching `${siteUrl}/${INDEXNOW_KEY}.txt` and matching the response body against the submitted key. The file therefore has to be reachable on the public origin.

This directory (`apps/storefront/public/`) is the source-of-truth for static assets baked into the storefront's `dist/apps/storefront/client/` bundle by `nx build storefront`. The Dockerfile `COPY` step at `apps/storefront/Dockerfile:47` seals that bundle into the runtime image.

Two constraints rule out using this directory for the IndexNow key:

1. **Gitignore.** `.gitignore` excludes `apps/storefront/public/[a-f0-9]*.txt` to prevent operators committing keys. So the file is absent from the CI workspace and absent from the image.
2. **Rotation.** Even if the file were committed, every rotation would require a rebuild + redeploy cycle. Rotating an IndexNow key has no operational coupling to a code release.

## Where the file actually lives

In production, the file is served by edge nginx on the box that runs the storefront, not by the storefront container. The install stepper writes it when a key is entered at the SEO step:

- **Host path**: `deploy/<profile>/indexnow/<key>.txt`, next to the rendered compose file.
- **Container mount**: the rendered compose file (from `deploy/templates/compose.storefront.yml` or `compose.both.yml`) mounts that directory as `:ro` into `/etc/nginx/indexnow` on the edge nginx container.
- **nginx location**: the rendered storefront vhost (from `deploy/templates/nginx/storefront.conf`) matches `^/[a-f0-9]{8,128}\.txt$` and serves from `/etc/nginx/indexnow/`.

The rotation runbook lives in the operator manual, `docs/site/operate/store-settings.md`, under rotating the search-engine credentials. Don't replicate it here; one source of truth is enough.

## Local development

Local dev does not exercise the IndexNow path. The engine's `SearchEngineSubmitService.submitToIndexNow` fail-opens when `INDEXNOW_KEY` is unset (`apps/api/src/modules/seo/search-engine-submit.service.ts`). Leave the env var empty in local `.env` files; production submission is exercised by the e2e suite at `apps/api/test/seo-submission.e2e-spec.ts`.

If you do need to test the verification fetch locally — e.g. validating a Vite/Analog routing change that might intercept the key file — set `INDEXNOW_KEY=devkey00000000000000000000000000000000000000000000000000000000` and write `apps/storefront/public/devkey00000000000000000000000000000000000000000000000000000000.txt` containing the same value. The `.gitignore` covers the pattern; add the file via `git add -f` only if you need it to ride a feature branch (rare; reverse before merge).
