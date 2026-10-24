---
title: License renewal
description: What the admin shows as a license approaches and passes its expiry, how to install a renewed or re-issued file on a running store without a restart, and what a lapsed license does and does not change.
primaryQuery: ecommerce license renewal offline file
updated: 2026-10-21
schema: TechArticle
---

The license is an offline signed file the engine verifies at boot and reports in the admin. Renewing it is replacing the file. Nothing stops while you do, and nothing stops if you do not; this page says what changes at each stage and how to install the new file.

## The banner, stage by stage

The admin reads the license verdict on every page and shows a banner from thirty days before expiry:

- **Expiring.** Thirty days before the expiry date: a banner with the days left. The storefront and every admin screen work as before.
- **Grace.** From the expiry date, for thirty days: a stronger banner. Settings, catalogue edits, orders, payments and customer accounts all keep working.
- **Expired.** After the grace period: a permanent banner. The store keeps running and keeps taking orders.

The storefront never shows anything about the license and never goes down because of it.

## Renew

A renewal is a new file from the publisher for the same domains and a later expiry. For a commercial license, write to the contact address in the License section of the repository's `README.md` before the expiry date; renewal is at the list price of the same tier and is not automatic. For an evaluation license, request a new one at the same address. [Get a license](../getting-started/get-a-license.md) has both paths.

## Install the new file

Two ways, neither of which restarts anything:

- **In the admin.** Settings, License: the screen shows the plan, the bound domains and the expiry, and takes the new file. The engine verifies the signature and the domain binding before it accepts the upload, writes the file to the path the API reads, and the banner clears on the next request. A file that does not verify is refused with the reason and the running license stays in place.
- **With the installer.** Run `./setup.sh` again and give the new path at the license prompt; Enter through the rest. The installer verifies the file and copies it into the rendered stack's `config/` directory, which the API reads through a mount, so the License screen shows the new verdict on its next read. This is also the way when the admin is unreachable.

Either way, check the result under Settings, License: the expiry is the new date and the bound domains still cover the store's three hosts.

## Moving to a new domain

The claims bind hostnames, and an apex covers its subdomains. A store that changes its domain needs a re-issued file naming the new apex, free within the licensed year. Install it before the domains change: the API refuses to boot when the origins in the environment file are not covered, so the order is new file first, then the installer re-run with the new origins.

## What a lapsed license loses

Under the commercial terms, a lapsed license keeps the release it runs and loses updates: installing a release published after the expiry date needs a current license. Today this is a term of the agreement rather than a check in the software; the engine does not yet compare a release's publication date with the license expiry, so an update on a lapsed file installs. Renewing before the update is what keeps the store within its license.

An evaluation license that lapses behaves the same way: the banner is permanent, and nothing else changes.

## When the API refuses to start naming the license

This happens in two cases, on every profile: the file's signature does not verify, or its bound domains do not cover the origins in the environment file. The line printed says which. Install the right file through the installer with the API down, since the admin cannot run without the API.

A missing or unreadable file does not stop the API. It starts, the admin shows the license as `missing`, and a production boot logs a warning that names the cause. Restore the file, or install a new one through the admin or the installer.
