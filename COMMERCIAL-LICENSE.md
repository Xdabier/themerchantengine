# Commercial license for themerchantengine

This page explains the commercial license. The binding terms are the agreement Badii Studio signs with each licensee.

## Why two licenses

themerchantengine is published under the PolyForm Noncommercial License 1.0.0 (`LICENSE`). That license lets anyone read the code, run it, change it and share it for any noncommercial purpose, with no fee and no registration. It does not permit commercial use, and a store that takes money from customers is a commercial use.

A commercial license lifts that restriction for a named licensee, for a set number of stores, for a year at a time. Everything else stays the same: the code you run is the public code, and you keep the rights the noncommercial license already gives you.

## What counts as a paid store

- One store is one storefront domain served by one installation of the engine, with its own admin and database.
- A store is commercial from the moment it accepts an order from a customer for money, whether by card, cash on delivery, bank transfer, gift card or any other tender. A store in setup, a staging copy, a demo with test payments only, or a store that only publishes a catalogue with no checkout is not a paid store.
- Personal, educational and nonprofit stores stay under the noncommercial license and need no commercial license. A nonprofit that sells goods to fund its mission is a commercial use and needs one.
- An agency that installs stores for its clients needs a license that covers every commercial store it operates or has installed, or each client holds its own.

## Tiers

Each tier is a yearly subscription. The count is the number of paid stores running under the license at the same time.

- **Single.** One paid store. For a merchant who runs their own store.
- **Studio.** Up to five paid stores. For a freelancer or a small agency.
- **Agency.** Up to twenty paid stores. For an agency that installs stores for clients.
- **Unlimited.** No store cap. For a larger agency or a reseller.

Every tier includes the same software, the same updates for the licensed year, and the license file the install stepper needs. Support and hosting are not included; they are separate agreements.

Prices are published on the pricing page at themerchantengine.com. They differ by the licensee's country in three zones (global, Gulf, Maghreb), and the Maghreb zone offers the Single and Studio tiers only. The first twenty licenses sold carry a founder rate that stays locked for as long as that subscription renews without a gap.

## Renewal

- A license runs for twelve months from its issue date.
- Renewal is not automatic and is at the list price of the same tier. There is no renewal discount and no lifetime option.
- Expiry never stops a store. The admin shows a banner thirty days before expiry, a stronger one during the thirty days after it, and a permanent one after that. Nothing is blocked at any point: settings, catalogue edits, orders, payments and customer accounts all keep working, and the storefront never stops serving customers because of an expired license.
- What a lapsed license loses is updates. The release you are running at expiry is yours to keep running for as long as you like. Installing a release published after your expiry date needs a current license; the engine refuses to boot a newer release on a lapsed file and says so in one line.
- Moving a store to a new domain needs a re-issued license file, which is free within the licensed year.

## How the license is enforced

The license is an offline, Ed25519-signed JSON file that names the licensee, the tier, the store cap, the bound domains, the issue date and the expiry date. The engine verifies the signature against a public key baked into the release, at install and at every boot, and compares the release's publication date with the expiry date to decide whether a newer release may run. There is no license server, no phone-home and no telemetry. Badii Studio keeps the private key. Paid licenses are issued by hand; a thirty-day evaluation license bound to one domain is issued by a form on themerchantengine.com.

## How to buy

Write to badii@badii.studio with the licensee's legal name, the tier, and the storefront domains to bind. Badii Studio answers with a quote, an agreement to sign, and the license file once paid.

## Not covered by any tier

- Removing or altering the license verification.
- Sublicensing, reselling or hosting the engine as a service for third parties under a single license without an agreement that names that use.
- Trademark use of the names themerchantengine or Badii Studio beyond identifying the software.
