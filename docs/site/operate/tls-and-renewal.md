---
title: TLS and renewal
description: How the certificates are issued and renewed, the renewal timer and what it checks beyond certbot, the self-hosted expiry alert and why it exists, how to test both, and what to look at when an alert arrives.
primaryQuery: deploy ecommerce vps docker tls certbot renewal
updated: 2026-09-08
schema: HowTo
---

Certificates come from Let's Encrypt, issued by certbot's webroot challenge through the edge nginx, which owns port 80. The installer issued one per host and scheduled the renewal. This page is what runs, how to prove it, and what to do when the alert mail arrives.

Never re-issue with `--standalone`: it cannot bind port 80 while the edge holds it, and the renewal that follows fails the same way.

## Renewal

`themerchantengine-cert-renew.timer` fires twice a day, at 03:17 and 15:17, and runs `deploy/shared/certbot-renew.sh`: `certbot renew` for every certificate in the store, a reload of the edge, and then a read of the certificate the edge actually serves for every host, failing the unit when one is inside twenty days of expiry. That last check is what tells a renewal that quietly stopped working from a healthy one, because `certbot renew` exits 0 whenever it decides nothing is due.

```bash
systemctl list-timers themerchantengine-cert-renew.timer --all
sudo systemctl start themerchantengine-cert-renew.service
journalctl -u themerchantengine-cert-renew.service -n 60 --no-pager
echo | openssl s_client -connect <apex>:443 -servername <apex> 2>/dev/null | openssl x509 -noout -dates
```

## Why the store alerts you itself

Let's Encrypt will not warn you. It ended expiry emails on 2025-06-04 and no longer stores an account contact, so a renewal that fails for ninety days ends in an outage nobody announced. Alerting is therefore self-hosted, on the box that carries the Resend key:

- `themerchantengine-cert-alert.timer` runs every morning at 08:00 and probes the storefront, admin and API hosts over public TLS. It mails only when one is under twenty-one days from expiry or serves nothing. The hosts come from the three public origins in the environment file, so a host cannot be missing from the sweep without also being missing from the install.
- The renewal unit carries `OnFailure=themerchantengine-cert-alert@%n.service`, so a failed renewal mails at once, with the unit's last log lines in the body.
- The mail goes from the store's sender address to `CERT_ALERT_TO` when that key is set in the environment file, otherwise to the contact-form recipient. A failure mail carries log lines, so set `CERT_ALERT_TO` to an operations address when the contact address is read by people outside operations.

A storefront-only box has no mail transport and gets renewal alone; its certificate is covered by the engine box's sweep from the outside. If the engine box itself is down, nothing alerts: closing that gap needs a third-party uptime monitor on the three hosts, which is worth having anyway.

## Test the alerting once

```bash
sudo systemctl start themerchantengine-cert-alert.service                                         # the real sweep; mails nothing while healthy
sudo DRY_RUN=1 bash deploy/shared/cert-expiry-alert.sh --reason themerchantengine-cert-renew.service  # print the failure mail, send nothing
ALERT_DAYS=999 bash deploy/shared/cert-expiry-alert.sh                                            # force a real send to prove the transport
```

Run the third one on the day you go live, so the first alert you ever receive is a test.

## When an alert arrives

1. `journalctl -u themerchantengine-cert-renew.service -n 60 --no-pager` says why the last renewal failed.
2. The host must still resolve to this box (`dig +short <host>`); a DNS change or a CDN put in front of the box breaks the webroot challenge.
3. Port 80 must be reachable from the internet (`sudo ufw status` and the provider's firewall) and the edge must be up with the webroot mounted (`$COMPOSE ps nginx`).
4. Fix the cause and start the renewal unit by hand. When it succeeds, the alert timer goes quiet on its own the next morning.

Let's Encrypt allows five failed validations per host per hour; a renewal loop that retries blindly locks itself out for an hour, which is why the timer runs twice a day and not every minute.

## Adding a host

A new hostname (a second storefront domain, a changed apex) is a re-run of the installer with the new origin at the domains step: it issues the certificate, renders the vhost, and the sweep picks the host up from the environment file. Do not add a certificate by hand.
