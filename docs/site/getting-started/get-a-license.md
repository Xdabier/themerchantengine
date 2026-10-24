---
title: Get a license
description: What the license file is, why a production install needs one, how to get a free evaluation license or a commercial one, how domain binding works, and what happens when a license expires.
primaryQuery: ecommerce offline license self-hosted
updated: 2026-10-21
schema: TechArticle
---

Every server install of themerchantengine needs a license file, including a store that will never take money. The file is small, offline, and checked by the engine itself; there is no license server, no activation call and no telemetry. This page says what it is, how to get one and what it does at expiry.

## What the file is

A JSON document with two keys: `claims` and `signature`. The claims name the licensee, the plan (the tier name), the number of stores the plan allows, the domains the license is bound to, the issue date and the expiry date. The signature is an Ed25519 signature over the claims, made with a private key that never leaves the publisher. The engine carries the matching public key in its build and verifies the file with it at install and at every boot.

Because the check is a signature, the file can be copied, backed up and committed to a private repository; nothing in it is secret. What it cannot be is edited: a changed claim breaks the signature and the engine refuses the file.

## What the API does without one

The API starts without a license file, in production too. A `LICENSE_FILE` path that is set but cannot be read (no file there, a directory, no read permission) counts as missing as well. The API reports the license as `missing` in the admin, and in production it also logs one warning at boot that names the cause:

```
The API runs unlicensed: no license file configured. Set LICENSE_FILE to the path of a readable license file issued for this store.
The API runs unlicensed: the configured license file cannot be read. Set LICENSE_FILE to the path of a readable license file issued for this store.
```

The installer copies the file you hand it into the rendered stack's `config/` directory and sets `LICENSE_FILE` for you, so on an installed box the second line means the file went missing or lost its permissions after the install. A file whose signature does not verify, or whose domains do not cover the store's hosts, is different: the API refuses to start, on every profile:

```
License check failed: <reason>. The API refuses to start.
```

The server installer still asks for a file, because a server store is expected to run under a license. [Install locally](./install-locally.md) lets you leave the license prompt empty.

## Two ways to get a license

**Noncommercial stores get an evaluation license for free.** themerchantengine is published under the PolyForm Noncommercial License 1.0.0: you may run it for personal, educational, research and nonprofit purposes with no fee. A production store should still run under a file, so the publisher issues a thirty-day evaluation license bound to one domain, free, on request at the contact address in the License section of the repository's `README.md`, with the domain to bind. Renew it the same way when it lapses. A store that starts taking money during an evaluation needs a commercial license from that day.

**Commercial stores buy a yearly license.** A store is commercial from the moment it accepts an order from a customer for money, by any tender: card, cash on delivery, bank transfer or gift card. Four tiers, priced by the number of paid stores running at the same time: Single (one store), Studio (up to five), Agency (up to twenty) and Unlimited. Every tier gets the same software and the same updates for the licensed year. Prices and the founder rates for the first twenty licenses are on the pricing page of themerchantengine.com. To buy, write to the contact address in the License section of the repository's `README.md` with the licensee's legal name, the tier and the storefront domains to bind; you receive a quote, an agreement and the file once paid. The full terms are in `COMMERCIAL-LICENSE.md` at the repository root.

A staging copy, a demo with test orders only, or a catalogue with no checkout is not a paid store. An agency that installs stores for clients needs a license that covers every commercial store it runs, or each client holds their own.

## Domain binding

The claims list bare hostnames. An apex covers its subdomains, so a license bound to `shop.example` covers `admin.shop.example` and `api.shop.example` as well. A `*` entry covers every host.

The installer checks the binding twice: once when you hand it the file, and again after you enter the three origins, when it refuses a host the claims do not cover. Moving a store to a new domain needs a re-issued file, which is free within the licensed year; install it through the admin's license screen or by running the installer again with the new path. Nothing else changes.

## What happens at expiry

Nothing stops. The license has four states after `valid`, and every one of them is a banner in the admin, never a cut:

- **Expiring.** From thirty days before the expiry date, the admin shows a banner with the days left.
- **Grace.** For thirty days after the expiry date, a stronger banner. Settings, catalogue edits, orders, payments and customer accounts all keep working.
- **Expired.** After the grace period, a permanent banner. The store keeps running.
- **Missing**: the admin shows the state and the reason, and a production boot logs a warning. The store keeps running. A file that does not verify (`invalid`) stops the API on every profile, local included.

What a lapsed commercial license loses is updates: the release you run at expiry is yours to keep running, and installing a newer release needs a current license. Today that rule is a term of the agreement rather than a check in the software; the engine does not yet compare a release's publication date with the license expiry. [License renewal](../operate/license-renewal.md) covers renewing and replacing the file on a running store.
