---
title: Account
description: "The signed-in customer's routes behind the session cookie and the ownership check: profile, saved addresses and the default address, the order history, returns, the wishlist and its id list, notification preferences, and the 401 and 403 envelopes a storefront maps."
primaryQuery: customer account rest api profile addresses order history wishlist returns notification preferences session cookie
updated: 2026-09-09
schema: TechArticle
---

This step gives a storefront its account area: the profile, saved addresses, the order history, returns, the wishlist and the notification consents. Every route on this page needs the Better Auth session cookie, and every one of them is scoped to the caller in the service, so a customer only ever reads and writes their own rows. That is the ownership half of obligation three of [the contract](./index.md#the-ten-obligations); the rule and the guard behind it are on the conventions page under [Permissions and ownership](../customize/conventions.md#permissions-and-ownership). No account page is public, so a storefront renders them on request only, with the cookie, and never caches them.

Every example below ran against a local engine serving the `demo` fixture. The customer is `w-account@l5.example`, signed up, verified through the link the development mail transport logged, and signed in as [Auth and session](./02-auth-and-session.md) shows; a second, seeded customer who owns a delivered order with a return appears where the fresh account has nothing to show.

## The request

All routes take the session cookie and `Accept-Language`; the write routes take `Content-Type: application/json`. A browser sends the cookie with `credentials: 'include'`; a server forwards the incoming `Cookie` header.

- Profile: `GET /v1/users/me` and `PATCH /v1/users/me` (`firstName`, `lastName`, `email`, `phone`, `avatarUrl`, `locale`, `newPassword`, `currentPassword`). Changing `email`, `phone` or the password requires `currentPassword` in the same body.
- Addresses: `POST /v1/users/me/addresses`, `PATCH /v1/users/me/addresses/{addressId}`, `DELETE /v1/users/me/addresses/{addressId}`, and `PATCH /v1/users/me/addresses/{addressId}/default` with `isDefaultShipping` or `isDefaultBilling`, at least one `true`. There is no list route: the profile carries `addresses`.
- Order history: `GET /v1/orders` with `page`, `pageSize` (1 to 100, default 20) and `status`. One order is `GET /v1/orders/{id}`, on [Checkout and orders](./05-checkout-and-orders.md).
- Returns: `POST /v1/orders/{orderId}/returns` with `items[]` (`orderItemId`, `quantity`, `exchangeVariantId` for an exchange), `reason` (`WRONG_SIZE`, `DEFECTIVE`, `NOT_AS_DESCRIBED`, `CHANGED_MIND`, `OTHER`), optional `reasonDetail`, `photoAssetIds`, `refundMethod` (`ORIGINAL_PAYMENT`, `STORE_CREDIT`, `EXCHANGE`). `GET /v1/returns` with `page` and `pageSize`, `GET /v1/returns/{id}`.
- Wishlist: `GET /v1/wishlist` (paged, with the product card fields), `GET /v1/wishlist/ids` (the bare id list, for the heart icon on every product), `POST /v1/wishlist/{productId}`, `DELETE /v1/wishlist/{productId}`.
- Notification preferences: `GET /v1/users/me/notification-preferences` and `PATCH /v1/users/me/notification-preferences` with `LIFECYCLE` and `MARKETING`, each `{ email, sms, push }`, any subset.

The parameter tables are on the [users](../reference/storefront-api/users.md), [orders](../reference/storefront-api/orders.md), [returns](../reference/storefront-api/returns.md) and [wishlist](../reference/storefront-api/wishlist.md) references.

```bash
curl https://api.shop.example/api/v1/users/me -b jar -H 'Accept-Language: en'

curl -X POST https://api.shop.example/api/v1/users/me/addresses -b jar \
  -H 'Content-Type: application/json' -H 'Accept-Language: en' \
  -d '{"label":"Home","fullName":"Camille Martin","phone":"+33 6 12 34 56 78","addressLine1":"10 rue de l Exemple","city":"Paris","postalCode":"75002","country":"fr","isDefaultShipping":true,"isDefaultBilling":true}'

curl 'https://api.shop.example/api/v1/orders?page=1&pageSize=5' -b jar -H 'Accept-Language: fr'
```

One helper serves every account call, in Node 22 or a browser. The cookie argument is for the server branch; a browser cannot set that header and sends the cookie through `credentials`:

```js
const API = 'https://api.shop.example/api';

async function account(path, { method = 'GET', body, locale = 'en', cookieHeader } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Accept-Language': locale,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error.message);
    err.code = json.error.code;
    err.status = res.status;
    throw err;
  }
  return json;
}

const me = (await account('/v1/users/me')).data;
const orders = await account('/v1/orders?page=1&pageSize=20');   // { data, meta }
const ids = (await account('/v1/wishlist/ids')).data.productIds;
await account(`/v1/wishlist/${productId}`, { method: 'POST' });
```

A `401` from any of these means the session is gone: send the visitor to sign in and back to the page, and never clear anything on a `429` or a `5xx` (see [Session bootstrap](../customize/conventions.md#session-bootstrap)).

## The response

### Profile

`GET /v1/users/me` right after sign-in:

```json
{
  "data": {
    "id": "2qW31lHE7Qfq01iIGBJdTfnB696IBZtu",
    "email": "w-account@l5.example",
    "phone": null,
    "firstName": "Camille",
    "lastName": "Martin",
    "role": "CUSTOMER",
    "isActive": true,
    "emailVerified": true,
    "phoneVerified": false,
    "avatarUrl": null,
    "locale": null,
    "roleId": null,
    "name": "Camille Martin",
    "twoFactorEnabled": false,
    "createdAt": "2026-09-09T16:35:44.733Z",
    "updatedAt": "2026-09-09T16:35:47.405Z",
    "addresses": [],
    "roles": []
  }
}
```

Render `firstName`, `lastName`, `email`, `phone`, `locale` and the `addresses` array; `emailVerified` decides whether to show a "verify your email" notice. `role`, `roleId` and `roles` exist for staff accounts and are empty for a customer. `PATCH /v1/users/me` with `{"locale":"fr","lastName":"Martin-Dupont"}` returned the same shape without `addresses`, with `"locale": "fr"` and the new name. `locale` is what the engine uses for the customer's mail and invoice PDF, so a storefront writes it when the customer switches language while signed in.

Changing `phone`, `email` or the password needs the current password in the same body. `{"phone":"+33 6 12 34 56 78"}` alone answered:

```json
{
  "error": {
    "code": "PROFILE_CURRENT_PASSWORD_REQUIRED",
    "message": "Current password is required to change email, phone, or password"
  }
}
```

With `"currentPassword"` added it returned the profile with `"phone": "+33612345678"`: grouping spaces are stripped before the number is stored. With a wrong password it answered `401 PROFILE_CURRENT_PASSWORD_INCORRECT`, and that `401` is not a lost session, so do not redirect on it. `{"phone":"call me"}` failed the shape rule before the service ran:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "phone",
        "messages": [
          "Invalid phone number format"
        ]
      }
    ]
  }
}
```

### Addresses

`POST /v1/users/me/addresses` with the body from the curl above. The country arrived as `fr` and was stored upper-cased; the phone lost its spaces:

```json
{
  "data": {
    "id": "cmtubl8hg00559sqsibfr7wv5",
    "userId": "2qW31lHE7Qfq01iIGBJdTfnB696IBZtu",
    "label": "Home",
    "fullName": "Camille Martin",
    "phone": "+33612345678",
    "addressLine1": "10 rue de l Exemple",
    "addressLine2": null,
    "city": "Paris",
    "state": null,
    "postalCode": "75002",
    "country": "FR",
    "isDefaultShipping": true,
    "isDefaultBilling": true,
    "createdAt": "2026-09-09T16:35:49.684Z",
    "updatedAt": "2026-09-09T16:35:49.684Z"
  }
}
```

The `id` is what the checkout sends as `shippingAddressId`; `isDefaultShipping` picks the preselected address. There is one default per kind: after a second address was created and then made the shipping default through `PATCH .../{addressId}/default` with `{"isDefaultShipping":true}`, the profile showed the first one with `"isDefaultShipping": false` and `"isDefaultBilling": true`. Deleting the second address (`204`, empty body) did not hand the flag back, so the profile then had no shipping default; a storefront falls back to the first address in that case. The default route with neither flag answered:

```json
{
  "error": {
    "code": "ADDRESS_DEFAULT_FLAG_REQUIRED",
    "message": "At least one of isDefaultShipping or isDefaultBilling must be true"
  }
}
```

A body that fails two rules lists both:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "phone",
        "messages": [
          "Invalid phone number format"
        ]
      },
      {
        "field": "country",
        "messages": [
          "Country must be a valid ISO 3166-1 alpha-2 code (e.g. US, GB)"
        ]
      }
    ]
  }
}
```

A `PATCH` on another customer's address id, with a valid session, is the ownership refusal from the service:

```json
{
  "error": {
    "code": "ADDRESS_ACCESS_DENIED",
    "message": "Access denied"
  }
}
```

That is a `403`. Deleting an address that is already gone is `404 ADDRESS_NOT_FOUND`.

### Order history

`GET /v1/orders?page=1&pageSize=5` after one order was placed against the saved address (`shippingAddressId` in the body, key `7713cf23-d253-4dc7-9996-43f771e582f2`):

```json
{
  "data": [
    {
      "id": "cmtublcf3005a9sqs0ezfzyw0",
      "orderNumber": "ORD-2026-000014",
      "status": "PENDING",
      "paymentStatus": "PENDING",
      "subtotal": 89,
      "discountAmount": 0,
      "shippingAmount": 10,
      "taxAmount": 17.8,
      "total": 116.8,
      "currency": "EUR",
      "couponCode": null,
      "createdAt": "2026-09-09T16:35:54.783Z",
      "updatedAt": "2026-09-09T16:35:54.783Z",
      "_count": {
        "items": 1,
        "shipments": 0
      }
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 5,
    "total": 1
  }
}
```

Rows are summaries, newest first: `orderNumber`, `status`, `paymentStatus`, `total` in `currency`, `createdAt` and `_count.items` are the columns of a history table, and `id` is the link to the order page. There are no lines and no product names in a row; the order page loads them. `meta` carries `page`, `pageSize` and `total`, so the pager computes the page count itself. `?status=DELIVERED` on this fresh account returned `"data": []` with `"total": 0`, and `?status=LOST` answered `400 VALIDATION_ERROR` listing the allowed values: `PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, COMPLETED, CANCELLED, ON_HOLD, RETURN_REQUESTED, RETURNED`.

Reading `GET /v1/orders/order-1`, another customer's order, with this session:

```json
{
  "error": {
    "code": "ORDER_NOT_YOURS",
    "message": "Not your order"
  }
}
```

A `403`: the id exists, the caller proved who they are, and the answer is honest. An anonymous caller would have been told `404` instead, as the checkout page explains.

### Returns

A return can only be requested on a `DELIVERED` order, inside the return window (thirty days from delivery by default, set by the operator), and only one active return per order. The fresh account's order is `PENDING`, so `POST /v1/orders/{orderId}/returns` answered:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Returns can only be requested for delivered orders",
    "details": {
      "message": "Returns can only be requested for delivered orders",
      "error": "Bad Request",
      "statusCode": 400
    }
  }
}
```

The returns module answers with the generic codes derived from the status, not with a code per rule, and `details` is only present outside production. A storefront therefore hides the "request a return" button unless the order is `DELIVERED` and inside the window, and shows one "this order cannot be returned" message for any `400` from this route. The same call on another customer's delivered order was `403 FORBIDDEN` with `Not your order`. The seeded customer who owns that delivered order could not open a second return either: `An active return (RET-2026-0001) already exists for this order`, again as `400 BAD_REQUEST`.

`GET /v1/returns` for the fresh account is `{ "data": [], "meta": { "page": 1, "pageSize": 20, "total": 0 } }`. For the seeded customer, `GET /v1/returns/return-1`, trimmed to the fields a storefront renders:

```json
{
  "data": {
    "id": "return-1",
    "returnNumber": "RET-2026-0001",
    "orderId": "order-4",
    "status": "REFUND_PROCESSED",
    "reason": "WRONG_SIZE",
    "reasonDetail": "Size 42 runs small; fits like a 41.",
    "refundMethod": "ORIGINAL_PAYMENT",
    "refundAmount": 349,
    "requestedAt": "2026-03-24T09:00:00.000Z",
    "approvedAt": "2026-03-29T10:00:00.000Z",
    "receivedAt": "2026-03-31T12:00:00.000Z",
    "refundedAt": "2026-04-01T09:00:00.000Z",
    "items": [
      {
        "id": "ri-1-1",
        "orderItemId": "oi-4-1",
        "quantity": 1,
        "orderItem": {
          "id": "oi-4-1",
          "sku": "SHOE-URB-42",
          "productName": "Urban Runner Sneakers",
          "unitPrice": 349,
          "quantity": 1
        }
        // ... variant, restockDecision, notes, exchangeVariantId
      }
    ],
    "photos": [],
    "order": {
      "id": "order-4",
      "orderNumber": "ORD-2026-000004",
      "status": "DELIVERED"
      // ... currency, createdAt
    }
    // ... customerId, customer, createdAt, updatedAt
  }
}
```

Render `returnNumber`, `status`, `reason`, `refundMethod`, `refundAmount` in the order's currency, the four dates as a timeline, and each item's `orderItem.productName` and `quantity`. The list route returns the same rows without `items` and `photos`, plus `_count.items`. The same `GET /v1/returns/return-1` with the fresh account's session was `403 FORBIDDEN` with `Not your return`.

### Wishlist

`POST /v1/wishlist/{productId}` answered `201` with `{ "productId": "cmtub361w001nwcqsf7pr7kb9", "productSlug": "fx-bottle-hydra-bottle-500" }`, and the same call again answered exactly the same `201`: adding is idempotent, so a double tap on the heart is harmless. `GET /v1/wishlist` then returned the product card fields, paged. Trimmed: the asset block is the same shape as on a product card, with `url` and eight `assetVariants` by width and format:

```json
{
  "data": [
    {
      "productId": "cmtub361w001nwcqsf7pr7kb9",
      "productSlug": "fx-bottle-hydra-bottle-500",
      "productName": "Hydra Bottle 500",
      "price": 89,
      "availability": "IN_STOCK",
      "variantId": "cmtub3626001owcqsruhqmn70",
      "primaryAsset": {
        "id": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        "assetId": "f39c48ed-0488-5b81-8be5-a153227bf56e",
        // ... url
        "type": "IMAGE",
        "altText": "Audio",
        "isPrimary": true,
        "sortOrder": 0,
        "assetVariants": [
          // ... eight { url, width, format } entries: 150, 400, 800 and 1200 wide, webp and avif
        ]
      },
      "addedAt": "2026-09-09T16:35:59.557Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

Render each row as a product card (`productName`, `price`, `availability`, the image) linking to `productSlug`, with `variantId` as the default variant for an "add to cart" button. `GET /v1/wishlist/ids` is the cheap call for the catalogue pages:

```json
{
  "data": {
    "productIds": [
      "cmtub361w001nwcqsf7pr7kb9"
    ]
  }
}
```

`DELETE /v1/wishlist/{productId}` is `204` with an empty body, and a second delete is `204` again. An unknown product on `POST` is `404 WISHLIST_PRODUCT_NOT_FOUND`.

### Notification preferences

`GET /v1/users/me/notification-preferences` for a new account, every consent off:

```json
{
  "data": {
    "LIFECYCLE": {
      "email": false,
      "sms": false,
      "push": false
    },
    "MARKETING": {
      "email": false,
      "sms": false,
      "push": false
    }
  }
}
```

`PATCH` with `{"MARKETING":{"email":true}}` returned the whole map with that one flag flipped; a patch carries only what changed and the answer is always the full map, so the settings page re-renders from it. `LIFECYCLE` covers the account and order mails, `MARKETING` the campaigns. A category the engine does not know is refused by the validation layer (`property NEWS should not exist`).

### Signing out

`POST /v1/auth/sign-out` answered `{"success":true}` with `Set-Cookie` headers that expire both session cookies (`Max-Age=0`). The next `GET /v1/users/me` on the same jar was `401`; the same envelope every route on this page answers without a session:

```json
{
  "error": {
    "code": "AUTH_UNAUTHENTICATED",
    "message": "Authentication required"
  }
}
```

## Error codes

The API's `message` is English whatever `Accept-Language` says; the storefront maps `code` to its own text in each locale. The generated list is [the error codes reference](../reference/error-codes.md).

Every route on this page:

- `AUTH_UNAUTHENTICATED`, 401: no session, or one that expired. Send the visitor to sign in with a return path.
- `RATE_LIMITED`, 429: the read or write budget is spent. Keep the session, wait for `Retry-After`, retry.
- `VALIDATION_ERROR`, 400: a field failed its rule; `details` names each field. Show the field errors on the form.

Profile:

- `USER_NOT_FOUND`, 404: the session's user no longer exists. Treat as signed out.
- `PROFILE_CURRENT_PASSWORD_REQUIRED`, 400: `email`, `phone` or `newPassword` sent without `currentPassword`. Ask for the password.
- `PROFILE_CURRENT_PASSWORD_INCORRECT`, 401: the password did not match. Mark the password field; this is not a lost session.
- `USER_CREDENTIAL_CHANGE_FORBIDDEN`, 400: the account has no password credential (it was created by a magic link), so it cannot change credentials here. Hide those fields for such accounts.
- `PROFILE_EMAIL_IN_USE`, 409: another account has that email. Mark the email field.

Addresses:

- `ADDRESS_NOT_FOUND`, 404: unknown id. Reload the list.
- `ADDRESS_ACCESS_DENIED`, 403: the id belongs to another customer. Reload the list; nothing to show the customer.
- `ADDRESS_DEFAULT_FLAG_REQUIRED`, 400: the default call sent neither flag. A bug in the storefront.

Orders:

- `ORDER_NOT_FOUND`, 404 and `ORDER_NOT_YOURS`, 403, as on [Checkout and orders](./05-checkout-and-orders.md#error-codes).

Returns, generic codes from the status:

- `NOT_FOUND`, 404: unknown order or return id.
- `FORBIDDEN`, 403: the order or return belongs to another customer.
- `BAD_REQUEST`, 400: the order is not delivered, the window closed, an active return exists, an item is not on the order or its quantity is too high, an exchange line has no `exchangeVariantId`, or a photo id is unknown. One message; hide the button unless the order qualifies.

Wishlist:

- `WISHLIST_PRODUCT_NOT_FOUND`, 404: the product does not exist or is not visible. Remove the heart.

Proved above with real requests: `AUTH_UNAUTHENTICATED`, `VALIDATION_ERROR`, `PROFILE_CURRENT_PASSWORD_REQUIRED`, `PROFILE_CURRENT_PASSWORD_INCORRECT`, `ADDRESS_DEFAULT_FLAG_REQUIRED`, `ADDRESS_ACCESS_DENIED`, `ADDRESS_NOT_FOUND`, `ORDER_NOT_YOURS`, `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND` and `WISHLIST_PRODUCT_NOT_FOUND`.

## Every locale

The wishlist carries the product name, so it is the account route where the locale shows. `GET /v1/wishlist` under `Accept-Language: en` and `fr`, trimmed to the row's text fields:

```json
{
  "data": [
    {
      "productId": "cmtub361w001nwcqsf7pr7kb9",
      "productSlug": "fx-bottle-hydra-bottle-500",
      "productName": "Hydra Bottle 500",
      "price": 89,
      "availability": "IN_STOCK"
      // ... the rest as above
    }
  ]
}
```

```json
{
  "data": [
    {
      "productId": "cmtub361w001nwcqsf7pr7kb9",
      "productSlug": "fx-bottle-hydra-bottle-500",
      "productName": "Gourde Hydra Bottle 500",
      "price": 89,
      "availability": "IN_STOCK"
      // ... the rest as above
    }
  ]
}
```

Only `productName` changes; `productSlug`, `price`, `availability` and the asset URLs are the same bytes. The order history rows carry no translatable field, so `GET /v1/orders?page=1&pageSize=5` returned identical bodies under both locales (the product names appear on the order page, where `items[].productName` follows the reader, as the checkout page shows). The profile, the addresses, the returns and the notification map are the customer's own data and enum values, and came back identical under `en` and `fr` too; `reason`, `status` and `refundMethod` are enums the storefront labels itself in each locale. The fixture has no RTL locale, so nothing changed direction.

## Framework notes

- Every account page is private: render it per request with the incoming `Cookie` forwarded to the API, and opt it out of every cache and prerender (`dynamic = 'force-dynamic'` and no `revalidate` in Next.js, `ssr: true` with no `routeRules` cache and no `swr` in Nuxt, `export const prerender = false` and `csr` off in SvelteKit). A static or ISR account page is another customer's data.
- The API answers `Cache-Control: no-store` and no ETag on all of these, so a browser never sends `If-None-Match`; if a proxy ever produces a `304`, treat it as success and keep the state you have (see [Browser caching and 304](../customize/conventions.md#browser-caching-and-304)).
- Relay the `Set-Cookie` headers of sign-in and sign-out to the browser when they pass through a server route, or the next SSR render still sees the old session.
- Resolve the session once per request with `get-session` and render either the page or the sign-in redirect; never half-render on a transient failure.

The long form, per framework, is on [Framework notes](./framework-notes.md#cookies-at-ssr).
