---
title: Technology detection
description: How the storefront, the admin and the API name the engine to technology detectors such as Wappalyzer and BuiltWith, how to add the major version or turn the markers off, and how to check a live site.
primaryQuery: themerchantengine wappalyzer builtwith detection generator meta x-powered-by
updated: 2026-10-29
schema: TechArticle
---

Technology detectors such as Wappalyzer, BuiltWith and `httpx -td` name the software behind a site by reading its headers and its HTML. Every store that runs the engine names the engine to them out of the box, with no setup step. This page lists what the engine sends, how to change it, and how to check a live site.

## What the engine sends

- A generator meta tag in the storefront and the admin HTML: `<meta name="generator" content="themerchantengine">`. This is the main marker, because a CDN or a proxy can strip headers but serves the HTML as it is.
- An `X-Powered-By: themerchantengine` header on the API, the storefront server and the admin. On the API it replaces the `X-Powered-By: Express` header, which is turned off.
- A `data-tme-app` attribute on the `<html>` element, set to `storefront` or `admin`, so a detector can tell the two apps apart.
- A read-only `window.themerchantengine` object in the browser, holding the app name. It is set only when the generator meta tag is present.

The markers carry the engine name only. They never carry the store's name, brand or domain, and they never carry the full version, because a full version tells an attacker which known bug a site may still have.

## Add the major version

Set this in the engine's environment file and restart the containers:

```bash
TME_FINGERPRINT_VERSION=major
```

The meta tag and the header then read `themerchantengine 1`. Version statistics in detector results need only the major version. There is no setting that sends the full version.

The admin is a static build served by nginx, so it always sends the name only. The setting applies to the API and the storefront.

## Turn the markers off

If your security policy says not to name the stack, set this in the environment file and restart:

```bash
TME_FINGERPRINT=off
```

The values `off`, `false`, `0` and `no` all work, in any case. With the markers off:

- The API sends no `X-Powered-By` header at all.
- The storefront drops the meta tag, the `data-tme-app` attribute and the header, and the browser object is not set.
- The admin container removes the meta tag, the attribute and the header when it starts.

## Check a live site

The detector rule the engine ships is `tools/fingerprint/themerchantengine.json`. The check script reads a URL the way a detector does and reports each rule:

```bash
npm run fingerprint:check -- https://shop.example.com
```

It checks the header, the generator meta tag and the `data-tme-app` attribute, and it exits with an error when none of them match. The browser object needs a real browser, so the script lists it but does not check it.

If the header shows as a miss behind a CDN, the CDN strips it. The meta tag still names the engine, so detectors still find the site.
