# Roadmap

The Merchant Engine is built and maintained by one person, Badii Boutar. This roadmap only lists what one maintainer plus contributors can carry. It changes after each release, and changes are logged at the bottom instead of being deleted.

Every item links to an issue or a discussion. If an item has no link, it is not started.

## How to read it

- **Now**: being worked on for the current v1.0.x line. Issues are open and claimable.
- **Next**: committed for v1.1. Badii builds the base first, then adapter issues open for contributors.
- **Later**: agreed direction, no date. Design happens in a discussion first.
- **Exploring**: ideas from users and contributors. Nothing here is promised.

## Now: v1.0.x (November 2026)

Goal: make the first contribution easy and fast to review.

- **Admin services fail cleanly on bad input.** Many admin services validate with `schema.parse()` before the Observable exists, so bad input throws instead of reaching the error handler. One issue per service, released in small batches. Label: `good first issue`.
- **More storefront languages.** The storefront ships French, English and Arabic. Adding a language is one registry entry plus a string file, and a partial file is fine because missing keys fall back to the default language. Spanish, German, Turkish and Portuguese are open first. Label: `good first issue`, `i18n`.
- **Install and docs fixes.** Every install report that hits a wall becomes a docs issue. Label: `documentation`.

## Next: v1.1 (December 2026 to February 2027)

Goal: the three gaps the README lists as "planned, not built yet".

- **Card payment at checkout.** Badii builds the storefront step that collects the card and confirms the session. After that, payment providers are open for contributors behind the existing `PaymentProvider` interface and its conformance suite. First candidates: Mollie, PayPal, Paymob, Konnect, Flouci, Tap, CMI. Label: `help wanted`, `payments`.
- **Mail transport interface.** Badii adds a transport interface so Resend is one adapter among others. Then an SMTP adapter opens for contributors. Label: `help wanted`, `mail`.
- **Deploy guides.** One guide per host, written and tested by someone who deployed there (Hetzner, DigitalOcean, Railway, Coolify, a plain VPS). Label: `documentation`, `help wanted`.

## Later (2027)

- **Live shipping rates and labels.** An interface for carrier rates and label printing, then one adapter per carrier.
- **Extensions.** A documented way to add a module, a payment provider or a shipping adapter without forking. Design starts in a discussion.
- **Admin translations.** The admin is English only today. The storefront language registry is the starting point.

## Exploring

Ideas live in the [Ideas discussions](https://github.com/Xdabier/themerchantengine/discussions/categories/ideas). React with 👍 on the ones you want. After each release, Badii reads the top ideas and moves some to Later or Next, with a short reason on the discussion.

Votes help, but they do not decide alone. Fit with the engine and the cost of keeping it working both count.

## How to take an issue

- Comment on the issue to claim it. Badii assigns it to you, usually the same day.
- One open claim per person at a time.
- A claim with no pull request or update after 7 days goes back to open. Ask for more time if you need it, that is fine.
- Every bug fix starts with a test that fails before the fix.
- If you used an AI tool, say so in the pull request. It is allowed. A pull request that does not match its issue is closed without debate.

## Change log

- 2026-10-30: first version.
