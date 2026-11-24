---
title: Store settings, secrets and integrations
description: Which values belong to the store and are edited in the admin's settings screens, which belong to the box and change by re-running the installer, how to rotate each secret and third-party key, and how the search-engine submission credentials are rotated.
primaryQuery: ecommerce store settings admin currency locale secrets rotation
updated: 2026-11-24
schema: TechArticle
---

The installer asked for two kinds of values. The store's own (its name, colours, locales, currency, domains) live in the database and are edited in the admin from the moment the install ends. The box's (keys, secrets, origins the containers bind to) live in the environment files and change by running the installer again.

## Edited in the admin, live on save

Every screen under Settings writes to the store's configuration, invalidates the API's cache and asks the storefront to revalidate, so a change is visible on the storefront's next request. Nothing restarts.

- **General.** Store name, trading name and description per locale, legal name, tax registration number, contact email and phone, address, timezone. The storefront's footer, the invoice header, the structured data and the transactional mail read from here.
- **Brand.** The one to three base colours, with the same palette preview and contrast report the installer showed, the font kit, the logo. The storefront's CSS variables are rendered from the generated palette on every request.
- **Locales.** The locales the store serves, the default, and which render right to left. Adding a locale adds a tab to every text field in the admin and a URL prefix on the storefront; removing one hides that locale's content rather than deleting it.
- **Money.** Currency code, symbol, position, separators, decimals shown, and whether prices display tax included, excluded or unmentioned. Prices are stored with three decimals whatever the currency; this screen decides how they render.
- **Domains.** The three public origins as the store publishes them in canonical URLs and mail links. Changing a domain here does not move the store: the certificates, the vhosts and the API's cookie domain come from the environment, so a real domain change is a re-run of the installer with the new origins.
- **Appearance.** The logo and favicon URLs the storefront renders.
- **Integrations.** It edits nothing itself and says where each integration is configured. Tracking identifiers (GA4, Meta, TikTok, Snap) are edited under Analytics, Tracking pixels, which the storefront reads. The Stripe keys saved on the payment methods page are stored encrypted in the database. Every other provider secret lives in the environment file and changes by re-running the installer.

Beyond Settings, the rest of the admin is also configuration in the same sense: tax zones and classes, shipping zones, carriers and methods, payment methods (switch cash on delivery, manual transfer or Stripe on and off here, and enter the Stripe keys), notification templates, the storefront's home sections and content pages. The installer seeded a first row of each from your answers; the admin owns them after. Saving the Stripe keys needs `PAYMENT_CONFIG_ENCRYPTION_KEY` in the environment file, which the installer does not write; [Install on a server](../getting-started/install-on-a-server.md) says how to add it.

## Changed by re-running the installer

Anything in the environment files. The prompts default to the previous answers, except the secrets, which a re-run asks for again because the state file never holds them. The install steps that follow are idempotent and take about half a minute when no image needs rebuilding.

```bash
cd /srv/themerchantengine
./setup.sh --profile engine     # the profile this box was installed with
```

- **Third-party keys:** the S3 key pair, the Resend key and webhook secret, the Turnstile secret, the Stripe keys, the IndexNow key, the Bing key, the Search Console service account. Enter the new value at its step. The step checks it live, and a wrong key stops the run before anything is written. The secret keys are asked for on every re-run, so have the current ones at hand even when you change only one.
- **The public origins** the containers bind to and the cookie domain derives from: the domains step.
- **The owner account:** the installer leaves an existing owner untouched. Change the owner's password from the login page: sign out, "Forgot password", and a new password from the email that arrives.

## Values the installer does not write

The installer rewrites the whole environment file from your answers on every run. A variable you add to it by hand that the installer does not own is gone after the next re-run: `PAYMENT_CONFIG_ENCRYPTION_KEY` and `PAYMENT_CONFIG_ENCRYPTION_KEYS_PREVIOUS`, `CERT_ALERT_TO`, the `TME_FINGERPRINT*` lines, `SENTRY_DSN`, `AUTH_COOKIE_DOMAIN`, the social sign-in client ids and a handful of tuning knobs the API reads with defaults. If you rely on one, re-add it after every re-run, or carry the change in your fork's templates. The payment key matters most: without it the Stripe keys saved in the admin cannot be read, so keep a copy off the box.

## Rotating a generated secret

The installer generated the database password (`DB_PASSWORD`, which it also writes into `DATABASE_URL`), the Redis password (`REDIS_PASSWORD`; a storefront-only box has its own `REDIS_PASSWORD` line in `apps/storefront/.env.production` holding a different secret from the engine box's), the session secret (`BETTER_AUTH_SECRET`), the signed-URL secret (`SIGNED_URL_SECRET`), the unsubscribe secret (`UNSUBSCRIBE_TOKEN_SECRET`) and the revalidate secret (`STOREFRONT_REVALIDATE_SECRET`), and keeps them on every re-run. To rotate one:

1. Stop the stack: `$COMPOSE down` (the compose command from [Topology](./topology.md)).
2. Delete that variable's line from the environment file (`.env.production`, mode `0600`).
3. Run the installer again. It generates a fresh value, re-renders the stack and brings it up.

Rotating the database or Redis password also means the running container's password has to follow, which is why the stack is down while you do it. Rotating the session secret signs every customer and staff member out.

**The revalidate secret** is shared by the engine and the storefront. On two boxes, rotate it on the engine first, then run the installer on the storefront box and give it the value the engine's closing line names:

```bash
grep STOREFRONT_REVALIDATE_SECRET .env.production      # on the engine box
```

When the API logs `dispatch: storefront returned 401`, the two are out of step.

## Rotating the search-engine credentials

Submission is fail-open: a refused submission logs a warning and never fails the change that triggered it, so a lapsed credential shows in the API log, not on the storefront.

**IndexNow.** The installer writes the key into the engine environment and the key file into `deploy/<profile>/indexnow/<key>.txt` on the box that runs the storefront, which the edge serves at `https://<apex>/<key>.txt`. To rotate, run the installer again with the new key on each box, then:

```bash
docker exec themerchantengine-edge nginx -s reload   # the storefront edge picks up the new file
$COMPOSE up -d api                                   # the API loads the new key
curl -s https://<apex>/<key>.txt                     # expect the key, content-type text/plain
```

Delete the old `<old-key>.txt` from `deploy/<profile>/indexnow/` once a submission with the new key has succeeded.

**Google Search Console.** Create the new service-account key in Google Cloud, hand its path to the installer's search-engine step, and delete the old key in Google Cloud once the installer's sitemaps check passed with the new one. The installer copies the file into the rendered stack's `config/` directory and proves it before the step passes. Never paste the JSON into a chat, an issue or a commit.

**Bing Webmaster.** Generate the new key in Bing Webmaster Tools, run the installer with it, then revoke the old one. The key travels in the query string, which is how Bing's API works, so scope it to this store.
