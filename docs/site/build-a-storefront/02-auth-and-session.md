---
title: Auth and session
description: "Better Auth under /api/v1/auth/*: sign-up and the verification mail, sign-in, get-session, sign-out, the two cookies a storefront carries with credentials: 'include', the atomic session bootstrap, and the bot protection a production store enables."
primaryQuery: ecommerce api customer sign up sign in session cookie better auth storefront
updated: 2026-09-09
schema: TechArticle
---

Customer accounts are Better Auth, mounted by the engine under `/api/v1/auth/*`. The session is one signed `HttpOnly` cookie; there is no token for your storefront to store, refresh or attach. This page serves two obligations of [the contract](./index.md#the-ten-obligations): three, carry the session cookie on every request, and five, bootstrap the session atomically, from one `get-session` call, committing the user and the signed-in state together or not at all, and never clearing a session on a transient failure. Every response below was captured from a local engine; the options in force are read from `apps/api/src/auth/auth.ts`.

## The routes and the options in force

Better Auth routes are not in the OpenAPI export; these are the ones a storefront uses, all relative to `https://api.shop.example/api/v1/auth`:

- `POST /sign-up/email`: body `email`, `password`, `name`, `firstName`, `lastName`, optional `callbackURL`. All three name fields are required: `name` by Better Auth's own body schema (a sign-up without it is refused with `VALIDATION_ERROR`, pasted under Error codes), `firstName` and `lastName` by the engine, which adds them to the user model. Send `name` as the two joined. `callbackURL` is a path on your storefront, `/en/account`; the rule for it is under The response.
- `POST /sign-in/email`: body `email`, `password`. Sets the session cookie.
- `GET /get-session`: the session and the user for the cookie sent, or the JSON literal `null`.
- `POST /sign-out`: revokes the session and clears the cookies.
- `GET /verify-email?token=...&callbackURL=...`: the link in the verification mail. Verifies, signs the customer in, redirects to `callbackURL`.
- `POST /send-verification-email`: body `email`, `callbackURL`; a second mail on demand.
- `POST /request-password-reset` (body `email`, `redirectTo`) and `POST /reset-password` (body `newPassword`, `token`).
- `POST /sign-in/magic-link` (body `email`, `callbackURL`): a password-less link, sent only to an existing active account, answered `{ "status": true }` either way so it cannot enumerate addresses.
- `POST /change-email`, `POST /delete-user`: both confirm by mail before anything changes.

Options a storefront must know:

- Cookie prefix `better-auth`. Cookies are `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production. With `AUTH_COOKIE_DOMAIN` set to the registrable domain (`.shop.example`) the cookie is shared by the storefront, the admin and the API hosts.
- Session: seven days, renewed by one day of sliding on use. A signed `session_data` cookie caches the session for five minutes so a page load does not hit the database; a revocation therefore takes at most five minutes to reach a cached client.
- Email verification gates sign-in for new accounts. Sign-up creates the user and sends the mail but sets no cookie; sign-in is refused with `EMAIL_NOT_VERIFIED` until the link is followed. A development engine may set `AUTH_SKIP_EMAIL_VERIFICATION=1` to turn the gate off.
- Password: 8 to 128 characters, bcrypt cost 12.
- Trusted origins come from `CORS_ORIGIN`, one comma-separated list read by two checks. The engine's CORS layer refuses any request whose `Origin` is not on the list. Better Auth then requires an `Origin` on every `POST` to an auth route that carries a `Cookie` header, and it must be on the same list; a `POST` with no cookie and no `Origin` passes. A browser always sends both, so a browser storefront only needs its origin on the list. A server-rendered storefront forwards the incoming `Cookie` header on every call, and the cart cookie is nearly always in it, so it must also send its own public origin as `Origin` (`https://shop.example`) on every auth `POST`, or the engine answers `403 MISSING_OR_NULL_ORIGIN` (proven under The response). A developer checkout sets the list in the root `.env`, copied from `.env.example`, where it names the four local ports; an installed engine sets it in the `.env.production` the installer writes, where it names the storefront and admin origins. Both files are on [Environment variables](../reference/environment-variables.md).
- Rate limits, per client IP, in every environment except the test one: five per fifteen minutes on `/sign-in/email`, `/sign-up/email`, `/sign-in/magic-link`, `/request-password-reset` and `/send-verification-email`; the source is `apps/api/src/auth/rate-limits.ts`.
- Bot protection on `/sign-up/email`, two layers. A honeypot header, `x-hp-field`, is always on: send it empty from a real form (a hidden input) and the request is refused when it comes back filled (`apps/api/src/auth/signup-hardening.ts`). Cloudflare Turnstile is on whenever the engine has `TURNSTILE_SECRET`, which a production store enables: the storefront renders the widget with its site key and sends the token in the `x-captcha-response` header; a sign-up without it is refused.

The rules the engine adds on top, and the customer-side routes that read the session, are on the conventions page under [Permissions and ownership](../customize/conventions.md#permissions-and-ownership).

## The request

Sign-up, from a browser form. `credentials: 'include'` is what makes the browser accept and later send the cookies; the two locale headers pick the language of the mail.

```bash
curl -s -D - -X POST https://api.shop.example/api/v1/auth/sign-up/email \
  -H "Content-Type: application/json" -H "Accept-Language: en" \
  -H "Origin: https://shop.example" \
  -d '{"email":"w-auth@l5.example","password":"Passw0rd!l5auth","name":"Walker Auth","firstName":"Walker","lastName":"Auth","callbackURL":"https://shop.example/en/account"}'
```

```js
const AUTH = 'https://api.shop.example/api/v1/auth';

async function auth(path, body, locale = 'en', extraHeaders = {}) {
  const response = await fetch(`${AUTH}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': locale,
      'X-Locale': locale,
      ...extraHeaders,
    },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

await auth('/sign-up/email', {
  email: 'w-auth@l5.example', password: 'Passw0rd!l5auth',
  name: 'Walker Auth', firstName: 'Walker', lastName: 'Auth', callbackURL: 'https://shop.example/en/account',
}, 'en', { 'x-hp-field': form.honeypot /* "" for a person */, 'x-captcha-response': turnstileToken });

await auth('/sign-in/email', { email: 'w-auth@l5.example', password: 'Passw0rd!l5auth' });
const session = await auth('/get-session'); // body is null when signed out
await auth('/sign-out', {});
```

Sign-in, `get-session` and sign-out with curl, the cookie carried in a jar:

```bash
curl -s -D - -c jar -X POST https://api.shop.example/api/v1/auth/sign-in/email \
  -H "Content-Type: application/json" -H "Origin: https://shop.example" \
  -d '{"email":"customer1@test.com","password":"password123"}'
curl -s -b jar https://api.shop.example/api/v1/auth/get-session
curl -s -b jar -c jar -X POST https://api.shop.example/api/v1/auth/sign-out \
  -H "Content-Type: application/json" -H "Origin: https://shop.example" -d '{}'
```

`customer1@test.com` / `password123` is a seeded, already verified customer of the demo catalogue; the fresh account is verified further down.

## The response

Sign-up answers 200 with the user and `"token": null`, and sets no cookie: the account exists, the mail is on its way, nobody is signed in.

```http
HTTP/1.1 200 OK
Cache-Control: no-store
Access-Control-Allow-Origin: http://localhost:53300
Access-Control-Allow-Credentials: true
content-type: application/json
```

```json
{"token":null,"user":{"name":"Walker Auth","email":"w-auth@l5.example","emailVerified":false,"image":null,"createdAt":"2026-09-09T16:00:28.091Z","updatedAt":"2026-09-09T16:00:28.091Z","twoFactorEnabled":false,"firstName":"Walker","lastName":"Auth","id":"TxYChXlxRF7tLWeZu833PHAhF9IwuOGB"}}
```

Notice the envelope: Better Auth answers its own shape, not the engine's `{ "data": ... }`. Notice also that the auth routes carry no `X-Request-Id` header: the handler is mounted in front of the engine's request pipeline.

Sign-in, on the seeded customer, sets two cookies. Names as sent, values redacted:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
content-type: application/json
set-cookie: better-auth.session_token=<redacted>; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
set-cookie: better-auth.session_data=<redacted>; Max-Age=300; Path=/; HttpOnly; SameSite=Lax
```

```json
{"redirect":false,"token":"<redacted>","user":{"name":"Sam Customer","email":"customer1@test.com","emailVerified":true,"image":null,"createdAt":"2026-05-02T08:00:01.796Z","updatedAt":"2026-05-02T08:00:01.796Z","twoFactorEnabled":false,"firstName":"Sam","lastName":"Customer","id":"cmoo1x69w00azq8qslsv69jtb"}}
```

`token` in the body is the same secret as the cookie; a browser storefront ignores it and lets the cookie do the work. `Max-Age=604800` is the seven-day session; `Max-Age=300` is the five-minute cache cookie.

`GET /get-session` with the cookie. This is the one object a storefront commits at boot. The engine adds `role`, `roles`, `status` and `locale` to Better Auth's user, so no second profile call is needed (`session.token` redacted):

```json
{"session":{"expiresAt":"2026-09-16T18:03:01.727Z","token":"<redacted>","createdAt":"2026-09-09T18:03:01.727Z","updatedAt":"2026-09-09T18:03:01.727Z","ipAddress":"127.0.0.1","userAgent":"curl/8.7.1","userId":"cmoo1x69w00azq8qslsv69jtb","id":"Zc3xsiJvP61QCYGnYbbpU9uswzDdDYAI"},"user":{"name":"Sam Customer","email":"customer1@test.com","emailVerified":true,"image":null,"createdAt":"2026-05-02T08:00:01.796Z","updatedAt":"2026-05-02T08:00:01.796Z","twoFactorEnabled":false,"firstName":"Sam","lastName":"Customer","id":"cmoo1x69w00azq8qslsv69jtb","role":"CUSTOMER","roles":[],"status":"active","locale":null}}
```

`GET /get-session` without a cookie, and with a garbage cookie, both answer 200 with the literal `null`, not a 401:

```http
HTTP/1.1 200 OK
Cache-Control: no-store
content-type: application/json
```

```json
null
```

With the cookie, an engine route that needs a customer works; `GET /v1/users/me` answered 200 with the profile in the engine's `{ "data": ... }` envelope. Without it the engine answers its own 401 (pasted under Error codes).

`POST /sign-out` with the cookie clears everything and answers:

```http
HTTP/1.1 200 OK
set-cookie: better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
set-cookie: better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
set-cookie: better-auth.dont_remember=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
```

```json
{"success":true}
```

`GET /get-session` with the same jar afterwards is `null` again.

### The Origin header on the auth routes

The rule from the options list, run three ways on `POST /sign-in/email`. Each request carries a `Cookie` header, the shape a server-rendered storefront produces when it forwards the visitor's cookies (here the cart cookie). Without `Origin`:

```bash
curl -s -D - -X POST https://api.shop.example/api/v1/auth/sign-in/email \
  -H "Content-Type: application/json" -H "Cookie: sessionId=0f0e5d2c-6d5a-4f7e-9c1b-2a3b4c5d6e7f" \
  -d '{"email":"customer1@test.com","password":"password123"}'
```

```http
HTTP/1.1 403 Forbidden
Cache-Control: no-store
content-type: application/json
```

```json
{"message":"Missing or null Origin","code":"MISSING_OR_NULL_ORIGIN"}
```

With an `Origin` that is not in `CORS_ORIGIN` (`Origin: https://evil.example`), the CORS layer refuses it before Better Auth sees it, as a 500 in the engine's envelope:

```http
HTTP/1.1 500 Internal Server Error
Cache-Control: no-store
Content-Type: application/json; charset=utf-8
```

```json
{"error":{"code":"INTERNAL_SERVER_ERROR","message":"CORS policy: origin 'https://evil.example' not allowed"}}
```

(The `details` field, a stack trace, is cut here. A `Referer` from an unlisted origin with no `Origin` header reaches Better Auth's own check instead and answers `403 {"message":"Invalid origin","code":"INVALID_ORIGIN"}`.) With the trusted origin, `Origin: http://localhost:53300` on this engine, the sign-in answers 200 with the two cookies exactly as pasted above. The same request with neither a cookie nor an `Origin` also answers 200, which is why a bare `curl` looks permissive; the check switches on when a cookie travels. Sign-out follows the same rule: with the session cookie and no `Origin` it answers `403 MISSING_OR_NULL_ORIGIN` and the session survives (`get-session` on the same jar still returns the user); with the origin it clears the cookies as pasted above.

### The verification mail in development

The fresh account cannot sign in yet:

```json
{"message":"Email not verified","code":"EMAIL_NOT_VERIFIED"}
```

On a production engine the mail reaches the inbox. On a development engine the mail transport is `console` (`MAIL_TRANSPORT` unset or `console`), which sends nothing and logs one line per mail with the recipient and the subject only; the link is not in the log. The engine keeps the link for you on the notification audit row, outside production only (`apps/api/src/modules/mail/mail.service.ts` writes `metadata.actionUrl` when the engine is not in production). Read it from the database:

```bash
docker exec merchants-engine-postgres-dev psql -U postgres -d merchants_engine_dev -Atc \
  "select metadata->>'actionUrl' from \"NotificationLog\" where recipient='w-auth@l5.example' and \"templateCode\"='auth.email-verification';"
```

The row, as read (token redacted):

```json
{"id":"cmtuabrh40002d0qs7vu0jppr","templateId":"cmtal9nfj00lv5gqsoei5y6h4","templateCode":"auth.email-verification","channel":"email","recipient":"w-auth@l5.example","status":"sent","error":null,"metadata":{"dryRun": true, "locale": "en", "actionUrl": "http://localhost:53000/api/v1/auth/verify-email?token=<redacted>&callbackURL=http%3A%2F%2Flocalhost%3A53300%2Fen%2Faccount", "variables": {"actionUrl": "[redacted]"}, "providerMessageId": "console_7fda69b8-a3d5-4941-9598-4020cccce8ec"},"sentAt":"2026-09-09T16:00:28.12"}
```

The link is a `GET` on the API, valid for twenty-four hours. Opening it verifies the address, signs the customer in and redirects to the `callbackURL` the sign-up sent, with the session cookies on the redirect:

```http
HTTP/1.1 302 Found
Cache-Control: no-store
location: http://localhost:53300/en/account
set-cookie: better-auth.session_token=<redacted>; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
set-cookie: better-auth.session_data=<redacted>; Max-Age=300; Path=/; HttpOnly; SameSite=Lax
```

`callbackURL` is checked against the same trusted origins at sign-up time. An absolute URL on an origin not in `CORS_ORIGIN` is refused and no user is created:

```bash
curl -s -D - -X POST https://api.shop.example/api/v1/auth/sign-up/email \
  -H "Content-Type: application/json" -H "Origin: https://shop.example" \
  -d '{"email":"w-dogfood@l5.example","password":"Passw0rd!dogfood","name":"Dog Food","firstName":"Dog","lastName":"Food","callbackURL":"https://evil.example/en/account"}'
```

```json
{"message":"Invalid callbackURL","code":"INVALID_CALLBACK_URL"}
```

A relative path needs no listing and is the form to send: the same sign-up with `"callbackURL":"/en/account"` answered 200, the audit row held `verify-email?token=...&callbackURL=%2Fen%2Faccount`, and opening that link answered a redirect onto the path, on the API host, so the browser lands on `https://api.shop.example/en/account` unless the storefront and the API share an origin:

```http
HTTP/1.1 302 Found
Cache-Control: no-store
location: /en/account
set-cookie: better-auth.session_token=<redacted>; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
set-cookie: better-auth.session_data=<redacted>; Max-Age=300; Path=/; HttpOnly; SameSite=Lax
```

So send a relative `callbackURL` when the storefront proxies `/api/*` on its own origin, and an absolute one on the storefront's own origin (which is in `CORS_ORIGIN` already) when the API is on another host.

So the page at `callbackURL` in your storefront needs no token handling: it boots like any other page, calls `get-session`, and finds the customer signed in. The same jar on `GET /get-session`:

```json
{
  "session": {
    "expiresAt": "2026-09-16T16:12:13.824Z",
    "token": "<redacted>",
    "createdAt": "2026-09-09T16:12:13.824Z",
    "updatedAt": "2026-09-09T16:12:13.824Z",
    "ipAddress": "127.0.0.1",
    "userAgent": "curl/8.7.1",
    "userId": "TxYChXlxRF7tLWeZu833PHAhF9IwuOGB",
    "id": "F5kfBTMuJzozxkkCMI2q7ZGVL3JUJezr"
  },
  "user": {
    "name": "Walker Auth",
    "email": "w-auth@l5.example",
    "emailVerified": true,
    "image": null,
    "createdAt": "2026-09-09T16:00:28.091Z",
    "updatedAt": "2026-09-09T16:00:28.091Z",
    "twoFactorEnabled": false,
    "firstName": "Walker",
    "lastName": "Auth",
    "id": "TxYChXlxRF7tLWeZu833PHAhF9IwuOGB",
    "role": "CUSTOMER",
    "roles": [],
    "status": "active",
    "locale": null
  }
}
```

From here on the fresh account signs in like any other. `POST /sign-in/email` with the same credentials that were refused above now answers 200, the two cookies, and `"emailVerified": true`:

```json
{"redirect":false,"token":"<redacted>","user":{"name":"Walker Auth","email":"w-auth@l5.example","emailVerified":true,"image":null,"createdAt":"2026-09-09T16:00:28.091Z","updatedAt":"2026-09-09T16:12:13.798Z","twoFactorEnabled":false,"firstName":"Walker","lastName":"Auth","id":"TxYChXlxRF7tLWeZu833PHAhF9IwuOGB"}}
```

A verification mail on demand, `POST /send-verification-email` with `{"email","callbackURL"}`, answered `{"status":true}`. The password reset and the magic link go the same way: `POST /request-password-reset` answered `{"status":true,"message":"If this email exists in our system, check your email for the reset link"}` and `POST /sign-in/magic-link` answered `{"status":true}`; both links land on the same audit row in development.

### Sign-up for an address that already exists

Because verification gates sign-in, Better Auth answers a duplicate sign-up with a 200 and a made-up user, so nobody can learn which addresses have an account. `POST /sign-up/email` for `customer1@test.com`, the seeded and verified customer, with a new password and new names:

```json
{"token":null,"user":{"name":"Dog Food","email":"customer1@test.com","emailVerified":false,"image":null,"createdAt":"2026-09-09T17:03:43.548Z","updatedAt":"2026-09-09T17:03:43.548Z","firstName":"Dog","lastName":"Food","twoFactorEnabled":false,"id":"ERPPzPhGyLyTFDYfhYfvyUGFvS2EtrmI"}}
```

Nothing was written: the user row kept its id `cmoo1x69w00azq8qslsv69jtb`, its `emailVerified` and its `updatedAt` of `2026-05-02 08:00:01.796`, the user count stayed at 24, no mail row was added for that address, and a sign-in with the new password answered `401 INVALID_EMAIL_OR_PASSWORD`. Your storefront cannot tell this response from a fresh sign-up (same status, same shape, `"emailVerified": false`, a fresh id), so it must always show "check your mail" after a 200, and never "this address is taken". `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` is only ever answered by an engine that turned the verification gate off.

### The two cookies a storefront carries

- `better-auth.session_token` (and its five-minute companion `better-auth.session_data`): the customer session, set by sign-in and by the verification link, cleared by sign-out.
- `sessionId`: the anonymous cart, set by the cart routes on the first cart write and read by every cart, checkout and order call until sign-in folds the guest cart into the customer's ([Cart](./04-cart.md)). The name is declared in `apps/api/src/modules/cart/cart.constants.ts`.

Both are `HttpOnly`, so your JavaScript never reads them; it only has to make sure they travel. In a browser that is `credentials: 'include'` on every `fetch`, with the API origin allowed in `CORS_ORIGIN`. `SameSite=Lax` means the storefront and the API must share a registrable domain in production (`shop.example` and `api.shop.example`, with `AUTH_COOKIE_DOMAIN=.shop.example`), or the storefront proxies `/api/*` on its own origin, which is what the shipped storefront does (`libs/storefront-services/src/lib/auth/auth-client.ts` resolves the auth base to the current origin plus `/v1/auth`).

### The atomic bootstrap

One `get-session` at boot, on the browser, then one commit:

```js
async function bootSession(store) {
  let session = null;
  try {
    const response = await fetch(`${AUTH}/get-session`, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (response.ok) session = await response.json(); // null when signed out
  } catch {
    // network error: leave the store exactly as it was
  }
  if (session && session.user) store.setSession({ user: session.user }); // one write, or none
  store.markBooted(); // consumers wait on this, never on a half-written user
}
```

Three rules, each one a bug the shipped storefront has already had:

- Commit the user and the signed-in flag in one write. Never publish an "authenticated" state and fill the user in later; a consumer that runs in between renders a half-formed account.
- Never clear the session on a transient outcome. A `429`, a `5xx`, a timeout and a network error all resolve to "no session this time", and the store is left as it was, so a customer stays signed in across a rate-limit blip and an anonymous visitor gets the anonymous shell without an error.
- Signal that the boot finished, in a `finally`, so nothing polls a flag that is not yet meaningful.

The shipped implementation is `libs/storefront-services/src/lib/auth/auth.service.ts` (`getSession()` returns the parsed user or `null` for every outcome and never throws) and `boot()` in `apps/storefront/src/app/layout/layout-shell.component.ts` (one call, one `setSession`, `markBooted()` in `finally`, then the guest-cart merge and the cart read). The rule is stated once for both front ends under [Session bootstrap](../customize/conventions.md#session-bootstrap).

## Error codes

Two envelopes meet on this page, and a storefront needs a mapper for each:

- Better Auth answers `{ "message", "code" }` at the top level. `message` is English whatever `Accept-Language` says; map `code` to your own strings in each locale.
- The engine answers `{ "error": { "code", "message", "details"? } }` on its own routes ([Response and error envelopes](../customize/conventions.md#response-and-error-envelopes)).

Better Auth codes a storefront meets, each proven with a run where the shared rate limit allowed it:

- `EMAIL_NOT_VERIFIED`, 403, sign-in before the link was followed. Show "check your inbox" and a "send it again" button on `/send-verification-email`.

```json
{"message":"Email not verified","code":"EMAIL_NOT_VERIFIED"}
```

- `INVALID_EMAIL_OR_PASSWORD`, 401, sign-in with a wrong password (the same code for an unknown email, so nothing enumerates accounts). Show one message under the form, never per field.

```json
{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
```

- Rate limit, 429, after five sign-ins (or sign-ups) in fifteen minutes from one IP. No `code`; the seconds to wait are in the `x-retry-after` header, and the body is JSON although `content-type` says `text/plain`. Only a server can read that header today: it is not in the `Access-Control-Expose-Headers` list the API sends (`Retry-After` is, `x-retry-after` is not), so a browser storefront sees the 429 without the wait and shows a fixed "try again in a few minutes".

```http
HTTP/1.1 429 Too Many Requests
content-type: text/plain;charset=UTF-8
x-retry-after: 240
```

```json
{"message":"Too many requests. Please try again later."}
```

- Honeypot tripped, 400, sign-up with `x-hp-field` filled. Message only, no `code`; a real customer never sees it.

```json
{"message":"Registration could not be completed."}
```

- `INVALID_TOKEN` on the verification link. Not a JSON error: the link is a redirect, so a bad or expired token lands on `callbackURL?error=INVALID_TOKEN`. Your callback page reads the `error` query parameter and offers "send it again".

```http
HTTP/1.1 302 Found
location: http://localhost:53300/en/account?error=INVALID_TOKEN
```

- `VALIDATION_ERROR`, 400, sign-up with a body field missing or malformed; `message` names the field. Show the field. Pasted from a sign-up without `name`:

```json
{"message":"[body.name] Invalid input: expected string, received undefined","code":"VALIDATION_ERROR"}
```

- `MISSING_OR_NULL_ORIGIN`, 403, a `POST` that carried a `Cookie` header and no `Origin`; `INVALID_ORIGIN`, 403, the `Origin` (or, without one, the `Referer`) is not in `CORS_ORIGIN`. Both are a storefront bug, not a customer error: a server-rendered storefront sends its public origin as `Origin` on every auth `POST`. Log it and show the generic failure. Pasted under The response.
- `INVALID_CALLBACK_URL`, 403, an absolute `callbackURL` on an origin not in `CORS_ORIGIN`; nothing was created. Same treatment: fix the storefront to send a relative path or its own origin. Pasted under The response.
- `PASSWORD_TOO_SHORT`, 400, on sign-up, from Better Auth's own code list; not run here, because the shared sign-up limit was spent proving the honeypot. Mark the password field. `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, 422, is never answered while the verification gate is on: a duplicate sign-up is a 200 (pasted under The response).
- A Turnstile failure on a production store is a 400 from the captcha plugin (`MISSING_RESPONSE` when the header is absent).

Engine codes on the routes that read the session (catalogue: [Error codes](../reference/error-codes.md)):

- `AUTH_UNAUTHENTICATED`, 401, a customer route without a valid cookie. In the browser: redirect to sign-in. At SSR: render the anonymous page (Framework notes).

```json
{"error":{"code":"AUTH_UNAUTHENTICATED","message":"Authentication required"}}
```

- `AUTH_USER_DEACTIVATED`, 401, a valid cookie for an account the operator deactivated. Clear the local state and show "this account is closed".

One more shape worth knowing. A call with an `Origin` not listed in `CORS_ORIGIN` does not reach Better Auth at all; the engine's CORS layer refuses it, and today it does so as a 500 `INTERNAL_SERVER_ERROR` whose `message` is `CORS policy: origin 'https://evil.example' not allowed` (pasted under The response). Your storefront's origin belongs in `CORS_ORIGIN` before its first deploy.

## Every locale

Better Auth does not translate. The wrong-password sign-in under `Accept-Language: fr` and `X-Locale: fr`:

```json
{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
```

The same English `message` and the same `code` as under `en`; the storefront's French copy comes from mapping `INVALID_EMAIL_OR_PASSWORD`, not from the response. `get-session` under `fr` answers the same object as under `en`; there is nothing translatable in it.

What the locale does change is the mail: `Accept-Language` (or `X-Locale`) on the sign-up, the reset request and the magic-link request picks the language of the verification, reset and magic-link mails, and the audit row records it (`"locale": "en"` above). Send the page locale on every auth call, and send `callbackURL` with the locale prefix (`/fr/account`) so the customer lands back in the language they were reading.

## Framework notes

- At SSR, forward the incoming `Cookie` header to the API byte for byte, and relay every `Set-Cookie` the API answers back onto your response (append, never overwrite; the API may set two). The shipped factory, `apps/storefront/src/server/server-api-client-factory.ts`, builds one client per request from `req.headers.cookie` and a `Set-Cookie` sink on `res`; never cache that client across requests.
- Call `get-session` per request on the server, or not at all. Never from a shared cache, a module-level variable or a cached data loader: one customer's session would render for the next.
- Treat a 401 at SSR as "render anonymous", not as an error. The shipped server client passes `allow401AsNull` on routes that also render signed out (`apps/storefront/src/server/api-client.ts`), and `readErrorStatus` in `apps/storefront/src/server/server-companion-helpers.ts` is how a loader reads the status off a thrown error to decide between an empty page and a 500. The browser boot then resolves the real session after hydration.
- Sign-up, sign-in and sign-out are browser calls (`credentials: 'include'`, the page's `Origin`), not server actions: the cookie has to land in the customer's browser, and a server action would receive it instead. If you do call an auth `POST` from the server (a form action that relays the `Set-Cookie`), set `Origin` to the storefront's public origin yourself; the forwarded `Cookie` header makes Better Auth require it, and Node's `fetch` sends none.
- The long form for Next.js, Nuxt and SvelteKit is [Framework notes](./framework-notes.md).
