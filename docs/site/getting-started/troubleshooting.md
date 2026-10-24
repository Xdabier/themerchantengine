---
title: Troubleshooting
description: Every line the wrapper, the stepper and the installer print when they stop, with the cause and the fix, plus the day-two failures an operator meets on a running store.
primaryQuery: ecommerce docker install troubleshooting
updated: 2026-09-08
schema: TechArticle
---

The installer stops at the first thing that is wrong and prints one line saying what. This page lists those lines, grouped by where in the run they appear, with the fix. After any fix, run setup again: completed steps are kept and the run resumes where it stopped.

## Before the stepper starts

The wrapper prints `setup: <what>` and one indented instruction, and exits.

- **`This checkout has no .nvmrc, so the Node version it needs is unknown.`** The clone is incomplete or the tarball was extracted partially. Run setup from a complete clone or a fully extracted release.
- **`git is not installed.`**, **`Docker is not installed.`**, **`Node.js is not installed.`** Install the named tool and run again. Node has to be the major the engine pins, currently 22.
- **`Docker is installed but not reachable.`** (Linux) The daemon is stopped or your user is not in the `docker` group. `sudo systemctl start docker`, then `sudo usermod -aG docker $USER`, log out and in. The installer runs Docker as your user, never as root.
- **`Docker is installed but not running.`** (Windows) Start Docker Desktop and wait until it reports running.
- **`Docker Compose v2 is not installed.`** Install the `docker-compose-plugin` package on Linux; on Docker Desktop, update it, Compose v2 ships inside.
- **`Node 20 is installed but the engine needs Node 22.`** Install Node 22 (`nvm install 22 && nvm use 22`) and run again. On Windows, install the 22.x release from nodejs.org.
- **`Port 80 is in use.`** or **`Port 53000 is in use by <process> (pid <n>).`** Something else listens on a port the profile needs: another web server on 80 and 443 on a server, another project on 53000, 53200 or 53300 locally. Stop it. A re-run on an installed box skips this check when a container named `themerchantengine-*` is running.
- **`Unknown profile <x>.`** `--profile` takes `engine`, `storefront`, `both` or `local`.
- **`The stepper's dependencies did not install.`** The first run on a fresh clone installs the stepper's own few packages from its lockfile and needs the network. Check the connection and any proxy, then run again. A release tarball ships the stepper built, so this step does not run from one.
- **`running scripts is disabled on this system`** (Windows) PowerShell's execution policy refuses the wrapper. Run `powershell -ExecutionPolicy Bypass -File .\setup.ps1`.

## During the questions

The stepper prints `x   <step>: <reason>` and exits with code 4. Fix the cause and run again; the prompts up to that step default to your previous answers.

- **`stdin is not a terminal and no --answers document was given; nothing can answer the stepper`** You ran setup from a pipeline or a service without `--answers`. Give it a document, or run it in a terminal. See [Non-interactive runs and CI](./non-interactive-and-ci.md).
- **`<path>: <rule>`** with exit code 3. An answers document broke a validation rule at the named path, or has no answer for a path with no default. Fix the document; the rule is the same one the prompt shows.
- **`license: no file at <path>`** The path is relative to the repository root. Copy the file onto the box and give its path.
- **`license: <reason>`** The signature does not verify: the file was edited, truncated, or issued for a different build of the engine. Ask for the file again; never edit a license file by hand. See [Get a license](./get-a-license.md).
- **`domains: <host> does not resolve; add its DNS record and run setup again`** No A or AAAA record yet, or it has not propagated. Add it and wait until `dig +short <host>` answers.
- **`domains: <host> resolves to <ip> but this box answers on <ip>; point the record here and run setup again`** The record exists and points elsewhere: an old server, a CDN proxy, or the wrong box. Point it at this box. If the host sits behind a proxy on purpose, certbot's challenge cannot reach the box; the engine expects the box to terminate TLS itself.
- **`domains: <reason>`** naming the license. The license's bound domains do not cover one of the three hosts you entered. An apex covers its subdomains, so bind the apex, or ask for a re-issued file with the new domain.
- **`brand: <pair> ...`** The palette generated from your colours cannot reach the contrast floor for a text-on-background pair even after adjustment. Pick a primary colour that is not near-white, near-black or very low in saturation.
- **`storage: <message>`** The S3 probe (put, get, delete of one object) failed: wrong endpoint or region, a key without write access, or a bucket that does not exist. The message is the provider's. The warning **`a dotted bucket name forces path-style URLs; browsers may refuse the certificate`** is what it says: rename the bucket with hyphens.
- **`mail: <domain> is not a domain in this Resend account; add it and publish its DNS records`** The sender address's domain is not in the Resend account the API key belongs to. Add it under Domains.
- **`mail: <domain> is pending in Resend, not verified; publish its DNS records and run setup again`** The domain is added but its DNS records are not published or not propagated. Resend shows which record is missing.
- **`mail: <message>`** from the test send: the key is wrong, or lacks sending access. Create a key with sending access.
- **`turnstile: Cloudflare refused the secret key`** The secret does not belong to a widget in your account, or you pasted the site key twice. The secret starts with `0x` and is shown once when the widget is created.
- **`seo: <message>`** The Bing key was refused by a sites call, or the Search Console service account cannot list the property's sitemaps: the account is not added as a user on the property, the Search Console API is not enabled on its project, or the property string is wrong (`sc-domain:<domain>` for a domain property, `https://<domain>/` for a URL-prefix one). All three credentials are optional; empty skips.
- **`this is the public password committed in ci/answers.local.json for the CI install smoke; choose your own`** You copied the engine's CI document as a template for a server. Choose your own owner password; that one is public.
- **`summary: not confirmed; run setup again to change an answer`** You answered no at the summary. Nothing was written. Run again and change the answer you did not like.

## During the install

The installer prints `x   <step>: <reason>`, then `fix the cause and run setup again; completed steps are kept`, and exits with code 5 or 6.

- **A `docker build` step fails.** Read the error above the line; the two usual causes are the box running out of disk during the three image builds (`df -h /`, then `docker builder prune -af`) or out of memory (give Docker Desktop four gigabytes; on a server, add swap or a bigger box for the first build). Run again; completed images are cached.
- **`tls: ...` or certbot reports a failed challenge.** Certbot could not fetch the challenge file over `http://<host>/.well-known/acme-challenge/`. The host must resolve to this box (`dig +short <host>`), port 80 must be reachable from the internet (`sudo ufw status`, the provider's firewall), and nothing else may hold port 80. Never issue with `--standalone`: the edge owns port 80 and the renewal timer relies on the webroot. Let's Encrypt allows five failed validations per host per hour, so fix the cause before retrying.
- **`smoke: the API health at <url> answered <status or nothing>`** The API container did not come up healthy within a minute. `docker logs themerchantengine-api --tail 100` names the cause; a fresh API waits on Postgres and Redis health before it starts.
- **`smoke: the admin login page with its security headers at <url> answered ...`** The admin answered, but without every security header the install requires, or with a status other than 200. This is what a reverse proxy in front of the box, or a hand-edited nginx file, produces. Remove the proxy or restore the rendered vhost and run again.
- **`smoke: the storefront at <url> answered ...`** The storefront container did not start or cannot reach the API. `docker logs themerchantengine-storefront --tail 100`. On a storefront-only box, the engine's API origin you entered must be reachable from this box over TLS.
- **`demo catalogue skipped: the store already holds <n> user(s), and the demo seed is a first-install step`** Not an error. The demo catalogue only ever seeds an empty store, so a re-run cannot plant fictional products into a live one.
- **`systemd timers are Linux-only; renewal and backups are not scheduled on this platform`** Not an error on a laptop. On a server it means you are not on Linux, which is not a supported target.

## After the install, on a running store

- **The edge answers 502.** The upstream container is down or unhealthy. `docker ps` shows `(healthy)` next to the API when it is fine; `docker logs themerchantengine-api --tail 100` names the cause otherwise.
- **Admin login sets no cookie, or logs you out on every page.** The admin reaches the API through `/api` on its own host, so the session cookie is a first-party cookie on `admin.<apex>` and nothing has to be shared across subdomains. A login that sets no cookie means the admin is being served from a host other than the one its vhost renders (a proxy in front of the box, or a hand-edited vhost that lost the `/api` proxy), or `CORS_ORIGIN` no longer lists the admin origin. The vhost and `CORS_ORIGIN` are both written by the installer from the domains you entered; re-run it.
- **The storefront logs `revalidate signature mismatch`.** The revalidate secret differs between the engine's and the storefront's environment files. Rotate it as [Store settings](../operate/store-settings.md) describes.
- **Storefront search returns nothing.** The full-text search index was dropped by a schema push and not re-applied. Re-run the installer, or apply the index by hand as [Update the store](../operate/update.md) describes.
- **Product images answer 403.** The bucket serves objects with the ACL the installer set on them, and a bucket policy on the provider's console can override it. Allow public reads on the bucket, or re-run the installer's storage step to probe it again.
- **The API logs a warning from IndexNow or Search Console.** Submission is fail-open by design: a refused submission logs and never fails the change that triggered it. `docker logs themerchantengine-api | grep -i indexnow` shows the response; a 403 from IndexNow means the key file is not served at `https://<apex>/<key>.txt`.
- **The API refuses to start and names the license.** The license file under the rendered stack's `config/` directory is invalid, or its bound domains no longer cover the origins in the environment file. A missing file never stops the API: it logs a warning and the admin shows `missing`. Replace it through the admin's License screen while the previous file still runs, or run the installer again with the new file. See [License renewal](../operate/license-renewal.md).
- **A certificate alert email arrived.** The renewal unit failed or a host serves a certificate under twenty-one days from expiry. [TLS and renewal](../operate/tls-and-renewal.md) has the diagnosis in order.
