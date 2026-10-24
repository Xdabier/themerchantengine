---
title: Cart
description: "The anonymous cart behind the HttpOnly sessionId cookie: how the first add creates it, reading it under both locales, updating and removing lines, coupon and gift card, the shipping and tax estimate, clearing it, and folding it into the account cart on sign-in."
primaryQuery: ecommerce api anonymous cart cookie add to cart merge on sign-in coupon gift card estimate
updated: 2026-09-09
schema: TechArticle
---

This step gives a storefront a basket that survives page loads before the customer has an account, and the call that carries it into the account when they sign in. It serves the third obligation of [the contract](./index.md#the-ten-obligations): carry the anonymous cart cookie. The engine never asks the storefront for a cart id. It mints one on the first add, hands it back as an `HttpOnly` cookie named `sessionId`, and reads that cookie on every cart call after; a signed-in customer's cart is keyed on the session cookie instead. Everything below was run against a local engine serving the `demo` fixture and its fixture catalogue; the only edit to a pasted body is the asset host, replaced by `https://assets.shop.example`, and the cookie values, redacted.

## The request

Base: `https://api.shop.example/api/v1`. Every route on this page reads one of two cookies and answers `Cache-Control: no-store`.

- `GET /v1/cart`: the cart, with live prices and stock. Without a cookie it answers an empty cart and sets nothing.
- `POST /v1/cart/items` with `{ variantId, quantity }`: adds a line, or increments the line that already holds that variant. On an anonymous caller this is the call that creates the cart and sets the cookie.
- `PATCH /v1/cart/items/{itemId}` with `{ quantity }`: sets the quantity of a line.
- `DELETE /v1/cart/items/{itemId}`: removes a line; answers the cart.
- `POST /v1/cart/coupon` with `{ code }` and `DELETE /v1/cart/coupon`.
- `POST /v1/cart/gift-card` with `{ code }` and `DELETE /v1/cart/gift-card` (204).
- `GET /v1/cart/estimate?country=FR&postalCode=`: shipping rates and the VAT estimate for a destination; the default rate and the tax are stored on the cart so the next `GET /v1/cart` carries them.
- `DELETE /v1/cart`: empties the cart (204). The cart row and the cookie stay.
- `POST /v1/cart/items/{itemId}/save-for-later`: signed-in only; moves the line to the wishlist.
- `POST /v1/cart/merge`: signed-in only; folds the anonymous cart behind the `sessionId` cookie into the account cart and clears that cookie.

The generated [cart reference](../reference/storefront-api/cart.md) lists the body schemas.

### The cookie

`SESSION_COOKIE_NAME` in `apps/api/src/modules/cart/cart.constants.ts` is `sessionId`. The controller (`apps/api/src/modules/cart/cart.controller.ts`) sets it only from `POST /v1/cart/items`, only when the caller is anonymous, with these attributes:

- `HttpOnly`, so page JavaScript can never read it. The value is a bearer credential: after checkout it is the only key to a guest's order.
- `SameSite=Strict` and `Path=/`.
- `Secure` in production, not on a local `http://` engine.
- `Max-Age=2592000`: thirty days (`ANON_CART_EXPIRY_DAYS`), reset on every add.

The value is thirty-two random bytes, base64url encoded. When a request arrives without the cookie, the engine mints a fresh id for that one request; a `GET` with no cookie therefore answers an empty cart and does not set anything, and a `PATCH` or `DELETE` on a line with no cookie is a `CART_NOT_FOUND`.

### Headers that matter

- `Cookie: sessionId=...` on every cart call from an anonymous customer; `Cookie: better-auth.session_token=...` once signed in. A browser sends both by itself when every `fetch` carries `credentials: 'include'`; a server does it by forwarding the inbound `Cookie` header (see [Framework notes](#framework-notes)).
- `Accept-Language`, or `X-Locale` from a browser page: resolves `productName`, `shippingMethodName` and discount labels, and is also the locale the engine snapshots a variant label in at add time.
- `Content-Type: application/json` on the writes. No idempotency key: adds are cumulative by design and a retry adds again, so a storefront disables the button while the request is in flight.

### A framework-neutral fetch

```js
const API = 'https://api.shop.example/api/v1';

// Browser: the cookie jar is the browser's. credentials: 'include' is the whole obligation.
export async function addToCart(locale, variantId, quantity = 1) {
  const res = await fetch(`${API}/cart/items`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': locale,
    },
    body: JSON.stringify({ variantId, quantity }),
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error.code), body.error);
  return body.data; // the whole cart
}

// Node 22 (a server route): forward the customer's cookie in, pass any Set-Cookie back out.
export async function addToCartOnServer(locale, variantId, quantity, cookieHeader) {
  const res = await fetch(`${API}/cart/items`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': locale,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({ variantId, quantity }),
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error.code), body.error);
  return { cart: body.data, setCookies: res.headers.getSetCookie() };
}
```

## The response

### Before any add

`GET /v1/cart` with no cookie:

```json
{
  "data": {
    "id": "",
    "items": [],
    "subtotal": 0,
    "discounts": [],
    "shippingEstimate": null,
    "shippingMethodName": null,
    "taxEstimate": null,
    "freeShippingProgress": null,
    "total": 0,
    "grandTotal": 0,
    "grandTotalTtc": 0,
    "itemCount": 0,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

No `Set-Cookie` came with it. A storefront renders the empty state from this without creating anything.

### The first add creates the cart and sets the cookie

`POST /v1/cart/items` with `{ "variantId": "cmtub35jt0014wcqswgyk5nwr", "quantity": 1 }` (the default variant of `fx-wl-headphones-daily-commute`), no cookie sent:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Set-Cookie: sessionId=<redacted>; Max-Age=2592000; Path=/; Expires=Fri, 09 Oct 2026 16:29:53 GMT; HttpOnly; SameSite=Strict
Content-Type: application/json; charset=utf-8
```

```json
{
  "data": {
    "id": "cmtubdleg00499sqszssijdf9",
    "items": [
      {
        "id": "cmtubdlex004a9sqsoyrpw0p2",
        "variantId": "cmtub35jt0014wcqswgyk5nwr",
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "categoryId": "cmtub34dg0001wcqs8bz1tsuw",
        "productName": "Daily Commute Wireless Headphones",
        "variantLabel": null,
        "productSlug": "fx-wl-headphones-daily-commute",
        "unitPrice": 549,
        "compareAtPrice": null,
        "quantity": 1,
        "lineTotal": 549,
        "inStock": true,
        "stockAvailable": 135,
        "thumbnailUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
        "weight": null
      }
    ],
    "subtotal": 549,
    "discounts": [],
    "shippingEstimate": 10,
    "shippingMethodName": "Standard delivery",
    "taxEstimate": null,
    "freeShippingProgress": {
      "threshold": null,
      "remaining": null,
      "qualified": false
    },
    "total": 549,
    "grandTotal": 559,
    "grandTotalTtc": 559,
    "itemCount": 1,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

Every write answers the whole cart, so a storefront replaces its cart state with `data` and never patches it locally. The same request a second time answers `quantity: 2` on the same line, not a second line, and the cookie is set again with a fresh thirty days.

### The cart shape a storefront renders

- `items[].id` is what `PATCH` and `DELETE` take; `variantId` and `productId` are the catalogue keys; `productSlug` is the link back to the product page.
- `productName` is the product's live `Translatable` name, resolved by `Accept-Language` on every read. `variantLabel` is different: it is plain text built once at add time from the variant's attribute values, in the locale of the add request, and it does not change on later reads. It is `null` when the variant has no attribute values, as here.
- `unitPrice` is the variant's live price, not the price at add time; `lineTotal` is `unitPrice` times `quantity`; `compareAtPrice` is the struck-through price or `null`.
- `inStock` and `stockAvailable` are live. Unlike the catalogue, the cart does carry the number, so a storefront can cap the quantity control at `stockAvailable`.
- `thumbnailUrl` is the `thumbnail` variant (150 px webp) of the product's primary image, or `null` while the asset is processing.
- `subtotal` is the sum of the lines. `discounts[]` lists automatic promotions and the coupon, each `{ promotionId, label, amount, type }` with `label` resolved by locale (a coupon's label is its code). `total` is `subtotal` minus the discounts, floored at zero.
- `shippingEstimate` and `shippingMethodName` are the store's default rate before any address is known (this fixture has one flat domestic rate, `10`), replaced by the destination's default rate after `GET /v1/cart/estimate`. `grandTotal` is `total` plus `shippingEstimate`.
- `taxEstimate` is `null` until an estimate has been requested for a country; then `grandTotalTtc` is `grandTotal` plus `taxEstimate`. On this fixture the store displays prices TTC (`money.taxDisplay`), yet the estimate below adds 20 % on top of the goods total: the tax service applies the destination zone's rate to the discounted subtotal and does not read the display setting. Show the figures the engine returns; do not re-derive them.
- `freeShippingProgress` is `null` on an empty cart and `{ threshold, remaining, qualified }` otherwise; `threshold` is `null` when no free-shipping rule exists.
- `couponCode` and `giftCard` (`null` or `{ code, balanceApplied }`, the applied balance re-checked on every read) are the tenders on the cart. `crossSellProductIds` is always empty today.
- `itemCount` is the sum of quantities, for the header badge.

### Update, second line, remove

`PATCH /v1/cart/items/cmtubdlex004a9sqsoyrpw0p2` with `{ "quantity": 2 }` answers the cart with `quantity: 2`, `lineTotal: 1098`, `subtotal: 1098`, `grandTotal: 1108`, `itemCount: 2` and nothing else changed. A second `POST /v1/cart/items` with the variant of `fx-laptop-pro-14-plus` added a second line and set the cookie again; `DELETE /v1/cart/items/{thatItemId}` answered the cart back at one line:

```json
{
  "data": {
    "id": "cmtubdleg00499sqszssijdf9",
    "items": [
      {
        "id": "cmtubdlex004a9sqsoyrpw0p2",
        "variantId": "cmtub35jt0014wcqswgyk5nwr",
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "categoryId": "cmtub34dg0001wcqs8bz1tsuw",
        "productName": "Daily Commute Wireless Headphones",
        "variantLabel": null,
        "productSlug": "fx-wl-headphones-daily-commute",
        "unitPrice": 549,
        "compareAtPrice": null,
        "quantity": 2,
        "lineTotal": 1098,
        "inStock": true,
        "stockAvailable": 135,
        "thumbnailUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
        "weight": null
      }
    ],
    "subtotal": 1098,
    "discounts": [],
    "shippingEstimate": 10,
    "shippingMethodName": "Standard delivery",
    "taxEstimate": null,
    "freeShippingProgress": {
      "threshold": null,
      "remaining": null,
      "qualified": false
    },
    "total": 1098,
    "grandTotal": 1108,
    "grandTotalTtc": 1108,
    "itemCount": 2,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

### Coupon and gift card

`POST /v1/cart/coupon` takes `{ "code": "..." }`, letters, digits, `-` and `_`, up to fifty characters, and answers the cart with `couponCode` set and a `coupon` entry in `discounts[]`; the fixture ships no promotion, so the run below proves the failure path instead. `DELETE /v1/cart/coupon` answers the cart with the coupon gone (200). Applying a coupon clears any stored shipping and tax estimate, because the VAT base changed; call `GET /v1/cart/estimate` again after.

`POST /v1/cart/gift-card` takes `{ "code": "..." }`, eight to twenty uppercase letters and digits, checks the card's balance and attaches the code; the cart then reports `giftCard: { code, balanceApplied }` with the balance capped at `grandTotalTtc`. `DELETE /v1/cart/gift-card` detaches it and answers 204 with no body. Neither call spends anything; the order does, at checkout.

### The estimate

`GET /v1/cart/estimate?country=FR` under `Accept-Language: en`:

```json
{
  "data": {
    "rates": [
      {
        "methodId": "sm-domestic-standard",
        "name": "Standard delivery",
        "price": 10,
        "isDefault": true,
        "estimatedDaysMin": 2,
        "estimatedDaysMax": 5
      }
    ],
    "taxEstimate": 219.6
  }
}
```

`rates[]` is every method that serves the destination, with `isDefault` on the one the order will charge unless the customer picks another at checkout. `taxEstimate` is the zone's rate on the discounted goods (`1098` at 20 %). Both are stored on the cart, so the next `GET /v1/cart` carries them:

```json
{
  "data": {
    "id": "cmtubdleg00499sqszssijdf9",
    "items": [
      {
        "id": "cmtubdlex004a9sqsoyrpw0p2",
        "variantId": "cmtub35jt0014wcqswgyk5nwr",
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "categoryId": "cmtub34dg0001wcqs8bz1tsuw",
        "productName": "Daily Commute Wireless Headphones",
        "variantLabel": null,
        "productSlug": "fx-wl-headphones-daily-commute",
        "unitPrice": 549,
        "compareAtPrice": null,
        "quantity": 2,
        "lineTotal": 1098,
        "inStock": true,
        "stockAvailable": 135,
        "thumbnailUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
        "weight": null
      }
    ],
    "subtotal": 1098,
    "discounts": [],
    "shippingEstimate": 10,
    "shippingMethodName": "Standard delivery",
    "taxEstimate": 219.6,
    "freeShippingProgress": {
      "threshold": null,
      "remaining": null,
      "qualified": false
    },
    "total": 1098,
    "grandTotal": 1108,
    "grandTotalTtc": 1327.6,
    "itemCount": 2,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

With no cart behind the cookie the estimate is `{ "rates": [], "taxEstimate": null }`, not an error. `DELETE /v1/cart` answers 204 and clears the lines, the tenders and both estimates; the next `GET /v1/cart` is the empty shape above with the cart's `id` kept.

## Error codes

Every code is in the [error code reference](../reference/error-codes.md); the `message` is English whatever the locale.

- `CART_INSUFFICIENT_STOCK`, 400: the line would exceed the variant's live stock. The check is on the cumulative quantity (what the line already holds plus the add), and an out-of-stock variant fails the same way on quantity one. Show "not enough stock" on the line and keep the cart as it was.
- `CART_VARIANT_NOT_FOUND`, 404: the variant id is unknown, inactive, deleted, or its product is deleted. The product page is stale; reload it.
- `CART_ITEM_NOT_FOUND`, 404: `PATCH`, `DELETE` or `save-for-later` on an item id that is not in this cart. Re-read the cart.
- `CART_NOT_FOUND`, 404: `PATCH` or `DELETE /items/{id}` from a caller that has no cart yet (no cookie, or a cookie nothing matches). Treat as an empty cart.
- `CART_EMPTY`, 400: a coupon or gift card applied to a cart with no lines. Disable the code fields until there is a line.
- `COUPON_INVALID`, 400: the code is unknown, inactive, expired, over its usage limit, under its minimum, or not applicable to these lines. One message for all of them; the engine does not say which.
- `GIFT_CARD_INVALID`, 400: the code is unknown, inactive, expired or empty.
- `VALIDATION_ERROR`, 400: `quantity` below 1, a coupon or gift-card code outside its pattern, `country` not two letters. `details[]` names the field; a storefront validates the same rules before sending.
- `AUTH_UNAUTHENTICATED`, 401: `merge` or `save-for-later` without a signed-in session.
- `CART_IDENTITY_REQUIRED`, 400: exists in the service but cannot be reached through these routes, since the controller always supplies a session id.
- `RATE_LIMITED`, 429: writes allow 30 a minute, coupon checks 15 and gift-card checks 10, per client. Back off on `Retry-After`.

Proof, `POST /v1/cart/items` with `{ "variantId": "cmtub35jt0014wcqswgyk5nwr", "quantity": 9999 }`:

```json
{
  "error": {
    "code": "CART_INSUFFICIENT_STOCK",
    "message": "Insufficient stock for the requested quantity"
  }
}
```

The default variant of `fx-tracker-step-se`, graded `OUT_OF_STOCK` in the catalogue, with `quantity: 1` answered the same body. `POST /v1/cart/items` with `{ "variantId": "00000000-0000-0000-0000-000000000000", "quantity": 1 }`:

```json
{
  "error": {
    "code": "CART_VARIANT_NOT_FOUND",
    "message": "Product variant not found or unavailable"
  }
}
```

`POST /v1/cart/coupon` with `{ "code": "NOSUCHCODE" }`:

```json
{
  "error": {
    "code": "COUPON_INVALID",
    "message": "Invalid coupon"
  }
}
```

`POST /v1/cart/gift-card` with `{ "code": "NOSUCHCARD1" }`:

```json
{
  "error": {
    "code": "GIFT_CARD_INVALID",
    "message": "Invalid or expired gift card"
  }
}
```

`DELETE /v1/cart/items/no-such-item`:

```json
{
  "error": {
    "code": "CART_ITEM_NOT_FOUND",
    "message": "Cart item \"no-such-item\" not found"
  }
}
```

`POST /v1/cart/coupon` with a cookie that has no cart behind it:

```json
{
  "error": {
    "code": "CART_EMPTY",
    "message": "Cart is empty"
  }
}
```

`PATCH /v1/cart/items/{id}` with that same cookie:

```json
{
  "error": {
    "code": "CART_NOT_FOUND",
    "message": "Cart not found"
  }
}
```

`POST /v1/cart/items` with `{ "quantity": 0 }`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "quantity",
        "messages": [
          "quantity must not be less than 1"
        ]
      }
    ]
  }
}
```

`POST /v1/cart/merge` with only the `sessionId` cookie:

```json
{
  "error": {
    "code": "AUTH_UNAUTHENTICATED",
    "message": "Authentication required"
  }
}
```

## Every locale

`GET /v1/cart` with the same cookie under `Accept-Language: fr`:

```json
{
  "data": {
    "id": "cmtubdleg00499sqszssijdf9",
    "items": [
      {
        "id": "cmtubdlex004a9sqsoyrpw0p2",
        "variantId": "cmtub35jt0014wcqswgyk5nwr",
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "categoryId": "cmtub34dg0001wcqs8bz1tsuw",
        "productName": "Casque sans fil Daily Commute",
        "variantLabel": null,
        "productSlug": "fx-wl-headphones-daily-commute",
        "unitPrice": 549,
        "compareAtPrice": null,
        "quantity": 1,
        "lineTotal": 549,
        "inStock": true,
        "stockAvailable": 135,
        "thumbnailUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
        "weight": null
      }
    ],
    "subtotal": 549,
    "discounts": [],
    "shippingEstimate": 10,
    "shippingMethodName": "Livraison standard",
    "taxEstimate": null,
    "freeShippingProgress": {
      "threshold": null,
      "remaining": null,
      "qualified": false
    },
    "total": 549,
    "grandTotal": 559,
    "grandTotalTtc": 559,
    "itemCount": 1,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

Against the English read of the same cart: `productName` (`Daily Commute Wireless Headphones` became `Casque sans fil Daily Commute`) and `shippingMethodName` (`Standard delivery` became `Livraison standard`) changed; every id, price and total is identical, and the storefront formats `559` as `559,00 €` on this fixture. `variantLabel` would not have changed either way, since it is a snapshot. `GET /v1/cart/estimate?country=FR` under `fr` answers the same `price: 10` and `taxEstimate: 219.6` with `"name": "Livraison standard"`. Error bodies are the same under both locales.

## Merge on sign-in

The anonymous cart is keyed on a cookie the page cannot read, so the storefront cannot send its id in a body. `POST /v1/cart/merge` has an empty body: the engine reads the `sessionId` cookie and the session cookie from the same request, folds the anonymous cart into the account cart, and answers the merged cart. That is why the two cookies have to travel together on this one call, which a browser does on its own with `credentials: 'include'` and a server does by forwarding the whole `Cookie` header.

The rules, from `mergeAnonymousCart` in `apps/api/src/modules/cart/cart.service.ts`:

- No anonymous cart, or an empty one: nothing happens and the account cart is returned.
- No account cart yet: the anonymous cart becomes the account cart, same id.
- Both exist: every anonymous line whose variant is not already in the account cart is copied over; a variant present in both keeps the account cart's quantity. The anonymous coupon and gift card carry across only when the account cart has none of its own. The anonymous cart is then soft-deleted.
- The response clears the `sessionId` cookie (`Set-Cookie: sessionId=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`), because it now points at nothing. A storefront that keeps sending the old value gets an empty anonymous cart, never the account one, so relay that clearing `Set-Cookie` to the browser exactly like the one that created the cookie.
- Call it on every sign-in and every sign-up that lands signed in; it is cheap when there is nothing to merge, and it is what moves a guest's placed order onto the account too.

### The run

A fresh customer `w-cart@l5.example` signed up, followed the verification link and signed in (the [auth page](./02-auth-and-session.md) walks that part), which set the `better-auth.session_token` cookie. With that cookie alone, `GET /v1/cart` is the account cart, still empty:

```json
{
  "data": {
    "id": "",
    "items": [],
    "subtotal": 0,
    "discounts": [],
    "shippingEstimate": null,
    "shippingMethodName": null,
    "taxEstimate": null,
    "freeShippingProgress": null,
    "total": 0,
    "grandTotal": 0,
    "grandTotalTtc": 0,
    "itemCount": 0,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

`POST /v1/cart/merge` with both cookies, the session cookie and the `sessionId` of the anonymous cart built above (two headphones), no body:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Set-Cookie: sessionId=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
Content-Type: application/json; charset=utf-8
```

```json
{
  "data": {
    "id": "cmtubdleg00499sqszssijdf9",
    "items": [
      {
        "id": "cmtubdlex004a9sqsoyrpw0p2",
        "variantId": "cmtub35jt0014wcqswgyk5nwr",
        "productId": "cmtub35jj0013wcqsxkysa45q",
        "categoryId": "cmtub34dg0001wcqs8bz1tsuw",
        "productName": "Daily Commute Wireless Headphones",
        "variantLabel": null,
        "productSlug": "fx-wl-headphones-daily-commute",
        "unitPrice": 549,
        "compareAtPrice": null,
        "quantity": 2,
        "lineTotal": 1098,
        "inStock": true,
        "stockAvailable": 135,
        "thumbnailUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
        "weight": null
      }
    ],
    "subtotal": 1098,
    "discounts": [],
    "shippingEstimate": 10,
    "shippingMethodName": "Standard delivery",
    "taxEstimate": null,
    "freeShippingProgress": {
      "threshold": null,
      "remaining": null,
      "qualified": false
    },
    "total": 1098,
    "grandTotal": 1108,
    "grandTotalTtc": 1108,
    "itemCount": 2,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

The customer had no account cart, so the anonymous cart was claimed as is: same cart id `cmtubdleg00499sqszssijdf9`, same line id, and the stored tax estimate dropped because the totals were recomputed. `GET /v1/cart` with the session cookie now answers that same cart (under `fr`, with `Casque sans fil Daily Commute` and `Livraison standard`), and `GET /v1/cart` with the old `sessionId` value answers the empty shape with `"id": ""`: the cookie points at nothing, which is why the response cleared it.

Signed in, `POST /v1/cart/items` with the variant of `fx-laptop-pro-14-plus` answered the cart with the new line and no `Set-Cookie`, since an account cart needs none:

```json
{
  "data": {
    "id": "cmtubdleg00499sqszssijdf9",
    "items": [
      {
        "id": "cmtubn204005s9sqswso15goo",
        "variantId": "cmtub34ym000ewcqs5yq04oj0",
        "productId": "cmtub34y8000dwcqs1gxegkn5",
        "categoryId": "cmtub348d0000wcqs7emj8cyg",
        "productName": "Northwind Pro 14 Plus Laptop",
        "variantLabel": null,
        "productSlug": "fx-laptop-pro-14-plus",
        "unitPrice": 2999,
        "compareAtPrice": 3299,
        "quantity": 1,
        "lineTotal": 2999,
        "inStock": true,
        "stockAvailable": 92,
        "thumbnailUrl": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
        "weight": null
      }
    ],
    "subtotal": 2999,
    "discounts": [],
    "shippingEstimate": 10,
    "shippingMethodName": "Standard delivery",
    "taxEstimate": null,
    "freeShippingProgress": {
      "threshold": null,
      "remaining": null,
      "qualified": false
    },
    "total": 2999,
    "grandTotal": 3009,
    "grandTotalTtc": 3009,
    "itemCount": 1,
    "couponCode": null,
    "giftCard": null,
    "crossSellProductIds": []
  }
}
```

(The headphones line is gone here because `DELETE /v1/cart` had been run in between; see above.) `POST /v1/cart/items/cmtubn204005s9sqswso15goo/save-for-later` answered the cart with no lines and the cart id kept, and `GET /v1/wishlist?pageSize=1` then held the product:

```json
{
  "data": [
    {
      "productId": "cmtub34y8000dwcqs1gxegkn5",
      "productSlug": "fx-laptop-pro-14-plus",
      "productName": "Northwind Pro 14 Plus Laptop",
      "price": 2999,
      "availability": "IN_STOCK",
      "variantId": "cmtub34ym000ewcqs5yq04oj0",
      "primaryAsset": {
        "id": "93c115b7-ea80-5ece-bd7c-06bafa0002f5",
        "assetId": "93c115b7-ea80-5ece-bd7c-06bafa0002f5",
        "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/small.webp",
        "type": "IMAGE",
        "altText": "Electronics",
        "isPrimary": true,
        "sortOrder": 0,
        "assetVariants": [
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.webp",
            "width": 150,
            "format": "webp"
          },
          {
            "url": "https://assets.shop.example/assets/seed-fixture-catalogue/42cf68bc34696e40247ebac6f935193d/thumbnail.avif",
            "width": 150,
            "format": "avif"
          },
          // ... 6 more entries: medium and large in webp and avif
        ]
      },
      "addedAt": "2026-09-09T16:37:15.618Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 1,
    "total": 1
  }
}
```

The wishlist routes themselves belong to the account step of this track.

## Framework notes

- Next.js, Nuxt and SvelteKit: a server-rendered cart page forwards the incoming `Cookie` header to `GET /v1/cart` and relays every `Set-Cookie` from the API onto its own response. A server action or route handler that adds to the cart does the same with the `Set-Cookie` from `POST /v1/cart/items`, or the browser never receives the cookie that names the cart it just created (`cookies().set` in Next.js, `setCookie` in Nuxt's `h3`, `cookies.set` in SvelteKit, each with the attributes the API sent).
- Never render the cart from a shared cache, a `stale-while-revalidate` layer or a static render: the response is per cookie. Fetch it with `cache: 'no-store'` and mark the route dynamic.
- Run the merge from the same server hop that handles the sign-in response, forwarding both cookies, and relay its clearing `Set-Cookie`; or run it from the browser right after sign-in with `credentials: 'include'`.
- The cart routes never answer 304, but keep the 304-as-success guard in the shared fetch wrapper; see [caching and 304](../customize/conventions.md#browser-caching-and-304).
- The long form for all three frameworks is on [framework notes](./framework-notes.md).
