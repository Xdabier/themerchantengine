# Deploying themerchantengine

The engine is installed and updated with the setup CLI, and operated from the manual that comes with it:

- [`docs/site/getting-started/install-on-a-server.md`](site/getting-started/install-on-a-server.md): what to have ready, the two-box install, the local profile, what the stepper asks and writes, non-interactive runs.
- [`docs/site/operate/`](site/operate/topology.md): the operator manual, one page per concern. Topology, updates, rollback, backups and restore, TLS renewal and alerting, timers and logs and disk, license renewal, store settings with secrets and search-engine submission. Failures are in [`docs/site/getting-started/troubleshooting.md`](site/getting-started/troubleshooting.md).

Two commands install a store on a prepared Linux box:

```bash
git clone <the engine repository> /srv/themerchantengine
cd /srv/themerchantengine && ./setup.sh
```

The installer owns the compose stack, the edge nginx, the certificates, the schema, the seeds and the owner account. It never touches SSH, the firewall or the OS; those stay the checklist of whoever prepared the box: a non-root user with `sudo`, key-only SSH, a firewall that allows 22, 80 and 443, Docker Engine with the Compose v2 plugin, git, and Node at the major named in `.nvmrc`.

There is no supported bare-metal or hand-assembled deployment. The Dockerfiles under `apps/*/Dockerfile` and the templates under `deploy/templates/` are the reference for anyone building a different topology, and the [technical specification](../specs/merchants-engine-technical-spec-v2.2.md) section 10 records the production posture they implement.
