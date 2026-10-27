---
title: Analytics and events
description: "The write-side signals a storefront sends: analytics events, the search event id you echo on click and on conversion, reviews and questions with their helpful votes, the newsletter double opt-in, the contact form, and the honeypot and Turnstile headers both doors require."
primaryQuery: storefront analytics events search click tracking reviews questions newsletter contact honeypot turnstile ecommerce api
updated: 2026-09-09
schema: TechArticle
---

This step gives a storefront the signals that feed the operator's dashboards and the customer-generated content on a product page: analytics events, search click and conversion tracking, reviews, questions, the newsletter and the contact form. No obligation of the contract requires these routes (see [the ten obligations](./index.md#the-ten-obligations)); what they do require is that the customer routes here carry the session cookie (obligation 3) and that every code below is surfaced in every locale (obligation 7). None of it blocks a page: every route here is fire and forget from the customer's point of view, and the shipped storefront never awaits an analytics post on a critical path.

## When the shipped storefront sends which event

`apps/storefront/src/app/services/analytics-tracker.service.ts` is the one place the shipped storefront calls `POST /v1/analytics/events`, through `libs/storefront-services/src/lib/analytics/analytics.service.ts`. It fires only in the browser, never at SSR, and swallows every error:

- `page_view` on every navigation, with `data.path`.
- `product_view` when a product page renders, with `productId` and `data.slug`.
- `add_to_cart` when an item is added, with `productId` and `data.quantity` (plus `data.variantId` when there is one).
- `begin_checkout` once per checkout attempt, keyed on the checkout's own idempotency key so a re-render cannot fire it twice, with `data.value`.
- `purchase` once per order, on the order-create success path and never on the confirmation page (a reload would double the revenue), with `orderId`, `data.orderNumber` and `data.value`. The order id is remembered in `sessionStorage` so a re-entry cannot send it again.
- `search` is in the catalogue and is not sent by the shipped storefront; the search endpoint records its own event, as the next section shows.

The tracker mints one session id per tab (`crypto.randomUUID()` in `sessionStorage`), adds `userId` when a customer is signed in, and always adds `locale`. Every event also reaches the vendor tags the operator enabled (GA4, Meta, TikTok, Snap), with the vendor names mapped in the same file.

## The request

Every route below is under `https://api.shop.example/api/v1/...`. Send `Accept-Language` on reads that return `Translatable` text (reviews, questions), `Content-Type: application/json` on every write, and the session cookie with `credentials: 'include'` on the routes that need a customer. The [conventions page](../customize/conventions.md#session-bootstrap) covers the cookie.

### Analytics: `POST /v1/analytics/events`

One event per request; there is no batch body. Public, no cookie needed, rate-limited at 30 requests per minute per client. Body fields, all optional but `eventType`:

- `eventType`: one of `page_view`, `product_view`, `add_to_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`, `search`.
- `sessionId`: up to 128 characters of `A-Z a-z 0-9 _ -`. A space or a colon is a 400.
- `userId`, `productId`, `orderId`: strings.
- `data`: any JSON object.
- `locale`: one of the locales the store enabled; `ar` on this store is a 400.

```js
const base = 'https://api.shop.example/api';
export function track(event) {
  // Never awaited by the caller, never allowed to throw.
  return fetch(`${base}/v1/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => undefined);
}
track({ eventType: 'product_view', sessionId, productId, locale: 'en', data: { slug } });
```

A `purchase` event triggers the server-side forwarding to Meta CAPI and GA4 Measurement Protocol after the 204 is sent; a forwarding failure never reaches the storefront.

### Search events: `POST /v1/search/events/{id}/click` and `/convert`

Every `GET /v1/search` response creates one search event and puts its id on every hit as `eventId` (the same id on each hit of that response). The storefront echoes it twice: on the click, with the product clicked and its position in the list, and on the conversion, when an order contains that product. Both are public, answer `204`, and are rate-limited at 30 per minute. The search itself is on [the catalogue page](./03-catalog-and-search.md); pass `X-Session-Id` on it so the event carries your session id.

```js
const hit = results.data[0];
await fetch(`${base}/v1/search/events/${hit.eventId}/click`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clickedProductId: hit.product.id, clickPosition: 0 }),
});
// Later, when the order is placed:
await fetch(`${base}/v1/search/events/${hit.eventId}/convert`, { method: 'POST' });
```

### Reviews

- `GET /v1/products/{slug}/reviews`: public, paged (`page`, `pageSize` up to 100), filters `rating`, sorts `createdAt`, `helpfulCount`, `rating` with `sortOrder`. Only `PUBLISHED` reviews.
- `GET /v1/products/{slug}/reviews/summary`: public; average, total, histogram, photo and verified counts.
- `GET /v1/products/{slug}/reviews/eligibility`: customer; whether this customer may review this product, with the reason when not.
- `GET /v1/products/{slug}/reviews/mine`: customer; the customer's own review in any status, or `null`. The public list hides a pending review, so this is how the author sees it.
- `POST /v1/products/{slug}/reviews`: customer; `rating` 1 to 5, `body` up to 5000 characters, optional `title` up to 200 and `assetIds` (UUIDs of uploaded assets). Refused unless the customer has a `DELIVERED` or `COMPLETED` order containing the product, and refused a second time for the same product. A new review starts in `PENDING` and appears in the public list once an operator publishes it.
- `PATCH /v1/reviews/{id}`: author only; same fields, all optional. The edited review goes back to `PENDING`.
- `DELETE /v1/reviews/{id}`: author only, `204`.
- `POST /v1/reviews/{id}/helpful`: customer; toggles the vote and answers `201` with `{ "helpful": true | false }`.

```js
const res = await fetch(`${base}/v1/products/${slug}/reviews/eligibility`, {
  headers: { 'Accept-Language': locale },
  credentials: 'include',
});
const { data } = await res.json(); // { eligible, reason }
```

### Questions

- `GET /v1/products/{slug}/questions`: public, paged, `PUBLISHED` only.
- `POST /v1/products/{slug}/questions`: customer; `question` up to 1000 characters. Starts in `PENDING`, so the poster does not see it in the list until an operator publishes it; there is no `/mine` for questions.
- `POST /v1/questions/{id}/answer`: any signed-in customer, the poster included and a pending question included, `answer` up to 5000 characters; answers `201` with the question. The first answer wins and a second one is a 409. An operator's answer through the admin carries `isAdminAnswer: true`; a customer's carries `false`.
- `POST /v1/questions/{id}/helpful`: toggle, same shape as the review vote.

### Newsletter

- `POST /v1/newsletter/subscribe`: public, bot-protected, `{ "email", "locale"? }`. Always `202` with `{ "status": "ok" }` whether the address is new, pending or already confirmed, so nothing about an address can be learned from this route. A new or pending address gets a confirmation mail.
- `GET /v1/newsletter/confirm?token=...&locale=...`: the link in that mail. Answers a `302` to `<storefront>/{locale}/newsletter/confirm?status=confirmed` or `?status=invalid`. Your storefront renders that page; the engine never renders HTML.
- `GET /v1/newsletter/unsubscribe?token=...&locale=...`: the footer link in a campaign; `302` to the same page with `status=unsubscribed` or `invalid`.
- `POST /v1/newsletter/unsubscribe?token=...`: the RFC 8058 one-click form a mail client posts; `200` with `{ "unsubscribed": true | false }`.
- `POST /v1/unsubscribe?token=...` and `GET /v1/unsubscribe`: the same pair for the account-level notification categories (order mails, lifecycle mails), signed with a different secret. The `GET` redirects to `<storefront>/{locale}/account/preferences?unsubscribed=<category>`.

A storefront exposes the two landing pages and nothing else; the tokens are minted and verified by the engine.

### Contact: `POST /v1/contact`

Public, bot-protected, `{ "fromName", "fromEmail", "subjectLine", "message" }` with the limits 120, 254, 200 and 5000 characters. Answers `202` with `{ "status": "received" }`. Rate-limited at five requests per fifteen minutes per client, which is tight on purpose. The shipped storefront has no contact form; the route exists for yours.

### Bot protection on the two doors

`apps/api/src/common/bot-protection/bot-protection.guard.ts` guards the newsletter subscribe and the contact form. Two layers, both carried as headers so the JSON body stays clean:

- The honeypot, always on. Render a text input that a person never sees (off-screen, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"`) and send its value in the `x-hp-field` header on every submit, empty included. Any non-empty value is a `400 BOT_DETECTED`, with no hint to the sender.
- Cloudflare Turnstile, on when the engine has `TURNSTILE_SECRET` set (production) and skipped when it is unset (development, tests). When it is on, render the Turnstile widget with your site key and send the token it yields in the `x-captcha-response` header. A missing token is `400 CAPTCHA_REQUIRED`; a token the verify call rejects is `400 CAPTCHA_FAILED`.

The shipped storefront's `apps/storefront/src/app/layout/newsletter-signup.component.ts` renders both and decides whether to mount the widget from the `VITE_TURNSTILE_SITE_KEY` build variable; `libs/storefront-services/src/lib/newsletter/newsletter.service.ts` sets the two headers.

```js
await fetch(`${base}/v1/newsletter/subscribe`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-hp-field': form.website,            // the hidden field, empty for a person
    ...(turnstileToken ? { 'x-captcha-response': turnstileToken } : {}),
  },
  body: JSON.stringify({ email: form.email, locale }),
});
```

## The response

An analytics event answers `204` with no body, and `Cache-Control: no-store` like every write:

```http
HTTP/1.1 204 No Content
Cache-Control: no-store
X-Request-Id: 7a5c8cb0-c598-44ff-984e-69c268b58828
```

A search for `hydra` under `Accept-Language: en`, trimmed to its first hit with the `thumbnail` and `primaryAsset` fields omitted (they are on the catalogue page). The `eventId` is the field to keep:

```json
{"data":[{"product":{"id":"cmtub361w001nwcqsf7pr7kb9","name":"Hydra Bottle 500","slug":"fx-bottle-hydra-bottle-500","brand":null,"tags":["bottle","home","cod-eligible","bestseller","new-arrival"],"isFeatured":false,"createdAt":"2026-09-09T16:21:46.724Z","minPrice":89,"avgRating":4.1,"reviewCount":8,"inStock":true,"availability":"IN_STOCK","categories":[{"id":"cmtub34kb0003wcqs5nxwa4bv","name":"Home Essentials"},{"id":"cmtub34qt000awcqsivos9mxs","name":"Hydration"}]},"eventId":"cmtub4n0f002y9sqsqebvd3r4","score":7.805882450938225}],"meta":{"page":1,"pageSize":2,"total":4}}
```

The click and the conversion on that id both answer `204` with no body. A second run of the same search returned `cmtubgd4b004k9sqsrhwc3t05` on its hit and these two calls landed on it:

```bash
curl -X POST "https://api.shop.example/api/v1/search/events/cmtubgd4b004k9sqsrhwc3t05/click" \
  -H "Content-Type: application/json" \
  -d '{"clickedProductId":"cmtub361w001nwcqsf7pr7kb9","clickPosition":0}'
# HTTP/1.1 204 No Content
curl -X POST "https://api.shop.example/api/v1/search/events/cmtubgd4b004k9sqsrhwc3t05/convert"
# HTTP/1.1 204 No Content
```

The review summary for that product renders the stars, the count and the histogram:

```json
{"data":{"averageRating":4.13,"total":8,"histogram":{"1":0,"2":1,"3":1,"4":2,"5":4},"withPhotos":0,"verifiedPurchases":5}}
```

The review list, trimmed to its first item. A storefront renders `rating`, `title`, `body`, `verifiedPurchase`, `helpfulCount`, `createdAt` and the reviewer's name; `status` is always `PUBLISHED` here:

```json
{"data":[{"id":"cmtub38ej0089wcqs843ncimt","productId":"cmtub361w001nwcqsf7pr7kb9","userId":"cmtub37co003fwcqspn7gd2tc","title":"Bon achat","body":"Utile et bien pensé. La prise en charge de l'arabe est un vrai plus.","locale":"fr","rating":5,"verifiedPurchase":true,"helpfulCount":6,"status":"PUBLISHED","createdAt":"2026-09-09T16:21:49.771Z","updatedAt":"2026-09-09T16:21:49.771Z","user":{"id":"cmtub37co003fwcqspn7gd2tc","firstName":"Saif","lastName":"Al Kuwari"},"assets":[]}],"meta":{"page":1,"pageSize":2,"total":8}}
```

Before showing the review form, ask whether this customer may write one. A signed-in customer with no delivered order containing the product gets the refusal, and `/mine` returns `null` because there is no review yet:

```json
{"data":{"eligible":false,"reason":"VERIFIED_PURCHASE_REQUIRED"}}
```

```json
{"data":null}
```

`reason` is `VERIFIED_PURCHASE_REQUIRED`, `ALREADY_REVIEWED` or `null`. On `eligible: true`, post the review; the `201` body is the review with `status: "PENDING"`, and `/mine` returns it from then on while the public list still does not.

The question list, trimmed to its first item. Render `question`, `answer` (null until answered), `isAdminAnswer` as a badge, `helpfulCount` and `asker`:

```json
{"data":[{"id":"cmtub390h00c8wcqsveb2xft1","productId":"cmtub361w001nwcqsf7pr7kb9","question":"Combien de temps prend la livraison vers l'Arabie saoudite ?","questionLocale":"fr","answer":"La plupart des commandes vers l'Arabie saoudite arrivent en 3 à 5 jours ouvrés.","isAdminAnswer":true,"helpfulCount":0,"status":"PUBLISHED","createdAt":"2026-09-09T16:21:50.561Z","updatedAt":"2026-09-09T16:21:50.561Z","asker":{"firstName":"Leila","lastName":"Hassan"},"product":{"id":"cmtub361w001nwcqsf7pr7kb9","slug":"fx-bottle-hydra-bottle-500"}}],"meta":{"page":1,"pageSize":2,"total":3}}
```

A question posted under `Accept-Language: fr` answers `201` with the question in `PENDING`:

```json
{"data":{"id":"cmtubkt8n004y9sqsc085jc4q","productId":"cmtub361w001nwcqsf7pr7kb9","question":"La bouteille passe-t-elle au lave-vaisselle ?","questionLocale":"fr","answer":null,"isAdminAnswer":false,"helpfulCount":0,"status":"PENDING","createdAt":"2026-09-09T16:35:29.927Z","updatedAt":"2026-09-09T16:35:29.927Z","asker":{"firstName":"Sam","lastName":"Customer"},"product":{"id":"cmtub361w001nwcqsf7pr7kb9","slug":"fx-bottle-hydra-bottle-500"}}}
```

The public list read right after still holds the three published questions and not this one (`meta.total` stayed at 3). Tell the customer the question is awaiting moderation; the response above is all they will see of it until an operator publishes it. The poster can still answer it while it is pending (`POST /v1/questions/{id}/answer` answered `201` with the answer filled and `isAdminAnswer: false`), and a helpful vote toggles:

```json
{"data":{"helpful":true}}
```

```json
{"data":{"helpful":false}}
```

Once an operator approved it in the admin, the same list under `Accept-Language: fr`, `pageSize=1`, newest first, is the question as every visitor sees it, `total` now 4:

```json
{"data":[{"id":"cmtubkt8n004y9sqsc085jc4q","productId":"cmtub361w001nwcqsf7pr7kb9","question":"La bouteille passe-t-elle au lave-vaisselle ?","questionLocale":"fr","answer":"Oui, le corps passe au lave-vaisselle, le bouchon se lave a la main.","isAdminAnswer":false,"helpfulCount":0,"status":"PUBLISHED","createdAt":"2026-09-09T16:35:29.927Z","updatedAt":"2026-09-09T16:35:33.833Z","asker":{"firstName":"Sam","lastName":"Customer"},"product":{"id":"cmtub361w001nwcqsf7pr7kb9","slug":"fx-bottle-hydra-bottle-500"}}],"meta":{"page":1,"pageSize":1,"total":4}}
```

Note the status codes: the answer and both helpful toggles answer `201`, not `200`.

The newsletter subscribe, with an empty honeypot header:

```json
{"data":{"status":"ok"}}
```

In development the engine's mail transport is `console`: nothing is sent, and the send-log row keeps the link outside production. Read through the admin (`GET /v1/admin/notifications/log?recipient=...`, permission `notifications:view`), the row for the subscribe above carried the confirm link in `metadata.actionUrl` (trimmed to the fields that matter):

```json
{"templateCode":"newsletter.confirm","channel":"email","recipient":"w-analytics@l5.example","status":"sent","metadata":{"dryRun":true,"locale":"en","actionUrl":"https://api.example.test/api/v1/newsletter/confirm?token=Y210dWF6YmltMDAxaTlzcXMzYTZ2YWl0Zw.brHF7Hd4vVBWlJRYsxLAvneCJGETOrYD8hULhxBQ6To&locale=en"}}
```

Following that link is the customer's click. It answers a redirect to the storefront's confirm page, and the token is not single-use (the same link answered the same redirect a second time). The host in the `Location` header is the storefront's public base URL from the engine's configuration:

```http
HTTP/1.1 302 Found
Cache-Control: no-store
Location: https://storefront.example.test/en/newsletter/confirm?status=confirmed
```

A subscribe with the same address after confirmation is the same `202` as the first one.

The confirm link with a bad token still redirects, to the `invalid` state:

```http
HTTP/1.1 302 Found
Cache-Control: no-store
Location: https://storefront.example.test/en/newsletter/confirm?status=invalid
```

The contact form:

```json
{"data":{"status":"received"}}
```

## Error codes

Codes are in [the error catalogue](../reference/error-codes.md); statuses and the storefront's reaction:

- `VALIDATION_ERROR`, 400, on every write: `details` names the field. Show it on the field. Proved on the analytics route with an unknown `eventType`; note that the message lists no allowed values, so keep the list from this page:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Validation failed","details":[{"field":"eventType","messages":["eventType must be one of the following values: "]}]}}
```

  and with a locale the store has not enabled:

```json
{"error":{"code":"VALIDATION_ERROR","message":"Validation failed","details":[{"field":"locale","messages":["locale must be a locale this store has enabled (en, fr)"]}]}}
```

- `NOT_FOUND`, 404, on `/v1/search/events/{id}/click` and `/convert` with an id no search returned. Drop it silently; a tracking miss is not a customer-facing error:

```json
{"error":{"code":"NOT_FOUND","message":"Search event not found","details":{"message":"Search event not found","error":"Not Found","statusCode":404}}}
```

- `AUTH_UNAUTHENTICATED`, 401, on every customer route without a session. Send the customer to sign in:

```json
{"error":{"code":"AUTH_UNAUTHENTICATED","message":"Authentication required"}}
```

- `REVIEW_PRODUCT_NOT_FOUND`, 404, on every review and question route with an unknown slug:

```json
{"error":{"code":"REVIEW_PRODUCT_NOT_FOUND","message":"Product \"no-such-product\" not found"}}
```

- `REVIEW_VERIFIED_PURCHASE_REQUIRED`, 400, on `POST .../reviews` without a delivered order. Hide the form; the eligibility route tells you before the customer types. Proved with the same customer as above:

```json
{"error":{"code":"REVIEW_VERIFIED_PURCHASE_REQUIRED","message":"A verified purchase is required to leave a review"}}
```

- `REVIEW_DUPLICATE`, 409, on a second review of the same product by the same customer. Show the existing one from `/mine` instead.
- `REVIEW_NOT_FOUND`, 404, and `REVIEW_NOT_OWNED`, 403, on `PATCH`, `DELETE` and `/helpful` with a wrong id or someone else's review. Proved on `/helpful` and on `PATCH` with a made-up id:

```json
{"error":{"code":"REVIEW_NOT_FOUND","message":"Review \"00000000-0000-4000-8000-000000000000\" not found"}}
```

- `ASSET_INVALID`, 400, when an `assetIds` entry is not an uploaded asset.
- `REVIEW_QUESTION_NOT_FOUND`, 404, on `/v1/questions/{id}/answer` and `/helpful` with an unknown id:

```json
{"error":{"code":"REVIEW_QUESTION_NOT_FOUND","message":"Question \"00000000-0000-4000-8000-000000000000\" not found"}}
```

- `QUESTION_ALREADY_ANSWERED`, 409, on a second answer. Show the answer already there. Proved by answering the question above twice:

```json
{"error":{"code":"QUESTION_ALREADY_ANSWERED","message":"This question has already been answered"}}
```

- `QUESTION_NOT_AVAILABLE_FOR_ANSWER`, 400, when the question was hidden by an operator.
- `BOT_DETECTED`, 400, on the newsletter and contact doors when the honeypot is filled. Show nothing specific; a person never fills it. Proved with `x-hp-field: filled`:

```json
{"error":{"code":"BOT_DETECTED","message":"Request could not be completed."}}
```

- `CAPTCHA_REQUIRED` and `CAPTCHA_FAILED`, 400, on the same two doors when Turnstile is on. Re-render the widget and ask for a new token. Not provable on this engine, which has no `TURNSTILE_SECRET`.
- `INVALID_UNSUBSCRIBE_TOKEN`, 400, on `POST /v1/unsubscribe` with a bad token. The newsletter twin never errors: `POST /v1/newsletter/unsubscribe` answers `200` with `{"unsubscribed":false}`, and both `GET` links redirect to `status=invalid`.

```json
{"error":{"code":"INVALID_UNSUBSCRIBE_TOKEN","message":"The unsubscribe link is invalid or has expired."}}
```

- `RATE_LIMITED`, 429, on every route here past its limit (30 per minute on the writes, 100 on the reads, five per fifteen minutes on the contact form). Back off; never retry an analytics post.

## Every locale

Review and question text is customer-written and stored once, in the locale of the `Accept-Language` the author sent (`locale` and `questionLocale` in the responses). The engine resolves it like any `Translatable`: the requested locale when the author wrote in it, the default text otherwise. The review above was written in `fr`, so `Accept-Language: en` and `Accept-Language: fr` return the same `title` and `body`; the same request on a review written in `en` would differ. A storefront that wants to show only reviews in the visitor's locale filters on `locale` client-side; there is no server filter. Render the `locale` field as the text's `lang` attribute.

The rest is locale-neutral: the summary numbers, the search `eventId`, the newsletter and contact acknowledgements. The newsletter redirect carries the locale you put on the link (`?locale=fr` produced `/fr/newsletter/confirm?status=invalid` in the run), and the `locale` field of the subscribe body decides the language of the confirmation mail. Send an analytics `locale` on every event; it is how the operator's dashboards split traffic by language.

## Framework notes

- Next.js: fire analytics from a client component with `keepalive: true`; a server action cannot see `sessionStorage`, so the session id lives in the browser. The newsletter and contact posts go straight from the browser to the API so the `x-hp-field` header arrives untouched; if you proxy them through a route handler, forward both bot headers verbatim.
- Nuxt: same split. Use `useFetch` with `credentials: 'include'` for the review routes and forward the incoming cookie in the SSR branch as [the framework notes](./framework-notes.md) describe.
- SvelteKit: `+page.server.ts` can load the review list and summary at SSR (public, no cookie); eligibility and `/mine` need the cookie forwarded with `fetch` from `event.fetch`.
- Every framework: never retry an analytics `POST`, never surface its failure, and treat a `NOT_FOUND` on a click event as a no-op.
