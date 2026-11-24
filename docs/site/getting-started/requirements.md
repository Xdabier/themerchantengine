---
title: Requirements
description: Everything to have ready before running the installer on a server. The box, the DNS records, the S3 bucket, the Resend domain, the Turnstile widget, and the optional Stripe keys and search-engine credentials, each with the console page where it is created.
primaryQuery: self hosted ecommerce requirements vps docker
updated: 2026-11-24
schema: TechArticle
---

The installer checks each of these live before it writes anything. If one is missing, the run stops at that prompt and you start it again once the item is ready. With everything at hand, a server install is a single run. The console links below were opened and checked on 2026-09-08.

## The box

- One Linux server for the whole store, or two if you want the storefront on its own box. Debian and Ubuntu are the tested targets. Two CPU cores and four gigabytes of memory build the images comfortably; the store itself needs less.
- A non-root user with `sudo`. The installer calls `sudo` for the systemd timers and nothing else.
- Key-only SSH and a firewall that allows ports 22, 80 and 443. The installer never touches SSH, the firewall or the OS.
- Docker Engine with the Compose v2 plugin: [Install Docker Engine](https://docs.docker.com/engine/install/), then [Install the Compose plugin](https://docs.docker.com/compose/install/linux/). Add your user to the `docker` group and log in again; the installer checks `docker info` as your user.
- git, from your distribution's package manager.
- Node.js 22. The installer refuses any other major and tells you which one it wants. Install it from [nodejs.org](https://nodejs.org/en/download) or with [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`).
- Twenty gigabytes of free disk. Three images are built from source and the build cache grows; [Timers, logs and disk](../operate/timers-and-logs.md) says how to reclaim it later.

For a laptop install, the list is shorter: [Install locally](./install-locally.md).

## The domains

Three hostnames, all pointing at the box before you start:

- The storefront apex, for example `shop.example`, plus `www.shop.example` if you want the redirect.
- `admin.shop.example` for the admin dashboard.
- `api.shop.example` for the API.

Create `A` records (and `AAAA` if the box has IPv6) at your DNS provider and wait until `dig +short admin.shop.example` answers with the box's address. The installer resolves each host and compares the answer with the box's own addresses; a host that resolves elsewhere stops the run before certbot is asked for a certificate it would fail to issue. Certificates come from Let's Encrypt through certbot's webroot challenge, which needs port 80 reachable from the internet. Their [rate limits](https://letsencrypt.org/docs/rate-limits/) allow five failed validations per hour per host, so fix DNS before retrying.

With two boxes, the apex points at the storefront box and the two subdomains at the engine box.

## An S3-compatible bucket

Product images, brand assets and the logo live in an S3-compatible bucket: AWS S3, OVHcloud Object Storage, Scaleway, Hetzner, Backblaze B2, MinIO or any provider with the S3 API. Create one bucket and a key pair with read and write access to it. Values to copy:

- The endpoint, `https://s3.<region>.<provider>`.
- The region name the provider uses.
- The bucket name. Use hyphens, not dots: a dotted name forces path-style URLs and browsers may refuse the certificate.
- The public URL prefix the browser fetches assets from, usually `https://<bucket>.s3.<region>.<provider>` or a CDN in front of it.
- The access key and the secret key.

The installer proves the bucket by writing, reading and deleting a probe object. Objects are written public-read; if your provider's bucket policy overrides object ACLs, allow public reads on the bucket.

## Resend, for transactional mail

Every email the store sends (order confirmations, password resets, account emails, the contact form) goes through [Resend](https://resend.com). Values to copy:

- A verified sending domain. Add your domain under [Domains](https://resend.com/domains) and publish the DNS records it shows. The installer looks the domain up in your account and refuses one that is not `verified`.
- An API key from [API keys](https://resend.com/api-keys), with sending access.
- A webhook signing secret. Create a webhook under [Webhooks](https://resend.com/webhooks) pointing at `https://api.shop.example/api/v1/webhooks/resend`, subscribed to the email events, and copy its signing secret (`whsec_...`). The engine records delivery status from these events.
- The sender address and display name, a reply-to address, and the address the storefront's contact form is delivered to.

The installer sends a test message to an address you name, so the mail path is proven before the store exists.

## Cloudflare Turnstile, for sign-up protection

Customer sign-up, the newsletter form and the contact form are protected by [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/). In the Cloudflare dashboard, open Turnstile from the account menu, add a widget for the storefront hostname (`shop.example`, and `www.shop.example` if you serve it), managed mode, and copy the site key (public) and the secret key. A Cloudflare account is free; the storefront's DNS does not have to be on Cloudflare.

The installer proves the secret against Cloudflare's verification endpoint.

## Optional: Stripe, for card payments

Cash on delivery and manual bank transfer need nothing from outside. To take cards, have a Stripe account and copy two values from its dashboard:

- The secret key (`sk_live_...`, or `sk_test_...` while you try it out).
- A webhook signing secret (`whsec_...`). Add a webhook endpoint pointing at `https://api.shop.example/api/v1/webhooks/payments/stripe` and copy the signing secret it shows.

You can also skip Stripe during the install and enter both values later on the admin's payment methods page. Keys saved there are encrypted with `PAYMENT_CONFIG_ENCRYPTION_KEY`, which the installer does not create; [Install on a server](./install-on-a-server.md) says how to add it.

## Optional: search-engine submission

Sitemaps and `robots.txt` work without any of these. With them, the engine pushes changed URLs to the search engines instead of waiting to be crawled.

- An IndexNow key. Generate one at [bing.com/indexnow](https://www.bing.com/indexnow/getstarted). The installer publishes the key file on your storefront host and the engine submits every changed product, category and page URL to IndexNow, which Bing, Yandex, Naver and Seznam share.
- A Bing Webmaster API key. Add the site in [Bing Webmaster Tools](https://www.bing.com/webmasters) (importing from Search Console is one click) and generate an API key under Settings, API access. Bing's [access guide](https://learn.microsoft.com/en-us/bingwebmaster/getting-access) walks through it. The key travels in the query string, which is how Bing's API works, so scope it to this store.
- A Google Search Console service account. Verify the storefront as a property in [Search Console](https://search.google.com/search-console). In Google Cloud, create a project, enable the Search Console API (Google's [prerequisites page](https://developers.google.com/webmaster-tools/v1/prereqs) walks through it), [create a service account](https://cloud.google.com/iam/docs/service-accounts-create) and download its JSON key. Back in Search Console, add the service account's `client_email` as a user on the property: Owner on a domain property, Restricted is enough on a URL-prefix property. Hand the JSON file's path to the installer, which proves the account with a sitemaps list call. Never paste the JSON into a chat, an issue or a commit.

## What the installer generates for you

You do not need to prepare database passwords, the Redis password, the session secret, the signed-URL secret, the unsubscribe token secret or the secret the storefront and the engine share for cache revalidation. The installer generates them, writes them to an environment file with mode `0600`, and keeps them across re-runs. The one secret it does not generate is `PAYMENT_CONFIG_ENCRYPTION_KEY`, which you need only for Stripe keys saved in the admin.
