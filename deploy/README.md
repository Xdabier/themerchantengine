# themerchantengine operator manual

The day-two manual for a store installed with `./setup.sh` moved into the
public documentation tree, which is what themerchantengine.com renders as the
Operate track:

- [`docs/site/operate/topology.md`](../docs/site/operate/topology.md): the
  containers per profile, the rendered stack directory, the environment files,
  the timers, and the compose command every other page starts from.
- [`docs/site/operate/update.md`](../docs/site/operate/update.md): updating by
  re-running the installer, and the two by-hand procedures (editing an nginx
  vhost, pushing the schema with the search index re-applied).
- [`docs/site/operate/rollback.md`](../docs/site/operate/rollback.md):
  `deploy/scripts/rollback.sh <git-ref>` and the schema caveat.
- [`docs/site/operate/backups-and-restore.md`](../docs/site/operate/backups-and-restore.md):
  the nightly dump, a manual dump, restore, what the dump does not contain.
- [`docs/site/operate/tls-and-renewal.md`](../docs/site/operate/tls-and-renewal.md):
  certbot webroot renewal, the served-certificate check, the self-hosted
  expiry alert and how to test it.
- [`docs/site/operate/timers-and-logs.md`](../docs/site/operate/timers-and-logs.md):
  the three timers, the container logs and the request id, disk reclaim, the
  one-liners.
- [`docs/site/operate/store-settings.md`](../docs/site/operate/store-settings.md):
  what the admin's settings screens own, what needs a setup re-run, rotating
  secrets and the search-engine credentials.

Failures, from the wrapper's first line to a running store's 502, are in
[`docs/site/getting-started/troubleshooting.md`](../docs/site/getting-started/troubleshooting.md).
The install itself is
[`docs/site/getting-started/install-on-a-server.md`](../docs/site/getting-started/install-on-a-server.md).

Everything under `deploy/` that is tracked in git is a template or a shared
script. Everything the installer writes lands under `deploy/engine/`,
`deploy/storefront/` or `deploy/local/` and is gitignored; a re-run of setup
rewrites it, so do not hand-edit a rendered file.
