---
title: Go-live checklist
description: The checks to run on a freshly installed store before customers arrive, each with the command that proves it. DNS and TLS, the backup timer, Search Console and Bing, the IndexNow key, llms.txt, Turnstile, the owner password, the demo catalogue.
primaryQuery: ecommerce go live checklist self hosted
updated: 2026-09-08
schema: HowTo
---

The installer probed the store before it printed its closing line, so the stack is up. This list is what the probes cannot know: that the outside world sees what the box sees, that the timers will fire, that the search engines know the store exists, and that nothing from the install is still in place that should not be. Run it once from a machine that is not the box, with `<apex>` as the storefront hostname.

## DNS and TLS

Every host resolves to the box and serves a certificate that is not about to expire:

```bash
for h in <apex> www.<apex> admin.<apex> api.<apex>; do
  echo "$h -> $(dig +short "$h" | tr '\n' ' ')"
  echo | openssl s_client -connect "$h:443" -servername "$h" 2>/dev/null | openssl x509 -noout -enddate
done
curl -sSI https://<apex>/ | grep -i strict-transport-security
```

Expect the box's address on every line, an `notAfter` date about ninety days out, and an HSTS header on the storefront. `http://` on any host redirects to `https://`.

## The three applications answer

```bash
curl -fsS https://api.<apex>/health
curl -fsS https://api.<apex>/api/v1/store/config | head -c 300
curl -fsSI https://admin.<apex>/ | grep -iE 'x-frame-options|content-security-policy'
curl -fsS -o /dev/null -w '%{http_code}\n' https://<apex>/
```

The health endpoint answers `ok`, the public configuration carries your identity, the admin door carries `X-Frame-Options: DENY` and a `frame-ancestors 'none'` policy, and the storefront answers 200 or a redirect to the default locale.

## Timers are scheduled

On the engine box:

```bash
systemctl list-timers 'themerchantengine-*' --all
sudo systemctl start themerchantengine-pg-backup.service && ls -lh /var/backups/themerchantengine/
```

Three timers should be listed with a next run: the certificate renewal twice a day, the expiry sweep every morning, the database dump every night. The manual start proves the dump works and leaves a first backup on disk. Then decide where the dumps are copied off the box: [Backups and restore](../operate/backups-and-restore.md).

## Mail leaves and comes back

The installer sent a test message; now send one the store generates. Sign up as a customer on the storefront, then check the address received the welcome or verification email, and that the admin's Notifications inbox shows it as delivered, which proves the Resend webhook reaches `https://api.<apex>/api/v1/webhooks/resend`. If the message shows as sent but never delivered, the webhook URL or its signing secret is wrong; re-run the installer's mail step.

## Turnstile is live

On the storefront's sign-up form, the Turnstile widget renders and a submission with no token is refused. From a terminal:

```bash
curl -sS -X POST https://api.<apex>/api/v1/newsletter/subscribe -H 'content-type: application/json' -d '{"email":"probe@example.com"}' -w '\n%{http_code}\n'
```

Expect a 400 naming the missing response. A 201 here means the storefront has no bot protection.

## The search engines know the store

- **Sitemap and robots.** `curl -fsS https://<apex>/robots.txt` names the sitemap; `curl -fsS https://<apex>/sitemap.xml` lists the locale sitemaps and each one lists the pages, products and categories that are active.
- **llms.txt.** `curl -fsS https://<apex>/llms.txt` returns the store's summary for AI crawlers; `https://<apex>/llms-full.txt` the long form.
- **IndexNow key, if configured.** `curl -fsS https://<apex>/<key>.txt` returns the key with `content-type: text/plain`. A 404 here means the key file is not served and every IndexNow submission will be refused.
- **Search Console.** Verify the property if the installer did not find it verified, and submit `https://<apex>/sitemap.xml` once by hand under Sitemaps; the engine resubmits after every regeneration when the service account is configured.
- **Bing Webmaster.** Import the site from Search Console or verify it, and submit the same sitemap once.

## Nothing from the install is still in place

- **The owner password.** If anyone other than the owner typed it, the owner changes it now: sign out, "Forgot password" on the login page, and a new password from the email that arrives.
- **The demo catalogue.** Off on a server unless you asked for it. If you did, delete the demo products and categories before the storefront is announced, or they are what the search engines index first.
- **Staff accounts.** Create one account per person under Staff with the least role that fits; do not share the owner login.
- **The answers document.** If you installed from `--answers`, the document may hold secrets. Move it off the box or delete it; the environment file holds everything the store needs.

## Write down what the box needs from you

The store now runs on its own, with two things it cannot do for itself: copying the nightly dump somewhere else, and acting on a certificate alert email. Put both in whatever runbook or calendar your team uses, and read [Topology](../operate/topology.md) once so the compose commands are familiar before the day you need them.
