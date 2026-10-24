---
title: Add a notification template
description: "Add a transactional email flow: the flow code, the per-locale subject and body defaults, the file fallback, the event-to-template dispatch row, the seed, the token allow-list the editor enforces, and the preview and test-send endpoints."
primaryQuery: add an email notification template nestjs ecommerce
updated: 2026-09-09
schema: HowTo
---

## When you need this

A domain event should send a customer or an operator an email: a back-order notice, a subscription renewal, a review reminder. A flow is a code such as `order.placed` with a Translatable subject and body per locale, stored as a `NotificationTemplate` row the operator edits in the admin, with a compiled file template as the fallback. This page walks `order.placed` end to end. You end with a flow that renders in every store locale, sends through the mail queue, appears in the admin editor with a token insert menu, and can be previewed and test-sent. The in-app dashboard notices in `apps/api/src/modules/notifications/notifications.constants.ts` are a different thing: they are the inbox bell, not email.

## Files you touch

- `apps/api/src/modules/mail/mail.types.ts`: the `MailJobName` union, the single list of flows.
- `prisma/notification-template-defaults.ts`: `MAIL_FLOW_CODES` and `TEMPLATE_DEFAULTS`, the seeded subject, body and variables per locale.
- `apps/api/src/modules/mail/templates/order.placed.ts` and `apps/api/src/modules/mail/templates/registry.ts`: the compiled fallback and the registry that maps every code to one.
- `apps/api/src/modules/mail/dispatch/dispatch.table.ts` and `apps/api/src/modules/mail/dispatch/resolvers.ts`: the event-to-template row and the resolver that produces recipient, locale and variables.
- `prisma/seed.ts`: the `seedNotificationTemplates` routing list.
- `apps/api/src/modules/notifications/notification-templates.service.ts`: the token guard, preview and test send.
- `apps/api/src/modules/notifications/dto/template.dto.ts`: the editor's request body.
- `apps/admin/src/app/features/notifications/template-editor.page.ts`: the editor.

## The pattern

### 1. Declare the flow

`apps/api/src/modules/mail/mail.types.ts`:

```ts
export type MailJobName =
  | 'auth.password-reset'
  | 'customer.welcome'
  | 'order.placed'
  | 'order.shipped'
```

The file header states the rule: add a flow only by extending this union, adding the template under `templates/<code>.ts`, and seeding the row. `MAIL_FLOW_CODES` in `prisma/notification-template-defaults.ts` mirrors the union and `npm run test:notification-defaults` checks it.

### 2. Write the default copy

`prisma/notification-template-defaults.ts`:

```ts
  'order.placed': {
    subject: {
      fr: 'Commande {{orderNumber}} reçue · {{storeName}}',
      en: 'Order {{orderNumber}} received · {{storeName}}',
      ar: 'تم استلام الطلب {{orderNumber}} · {{storeName}}',
    },
    variables: ['orderNumber', 'customerName', 'total', 'itemCount', 'orderUrl', 'storeName'],
    body: {
      en:
        h1('Order received') +
        p(
          'We received your order ' +
            mono('orderNumber') +
            ': {{itemCount}} ' +
            `item(s) for a total of <strong>{{total}}</strong> ${TTC.en}. We will write again when it ` +
            'ships.',
        ) +
        cta('orderUrl', 'View order', 'en'),
```

The `Translatable` type at `prisma/notification-template-defaults.ts:62-66` is a closed alias with `fr`, `en` and `ar` all required, so a subject or body that drops a locale fails to type-check. A body is the inner block only; the renderer wraps it in the brand layout. `{{token}}` is HTML-escaped, `{{{token}}}` is raw and belongs only inside an `href`. The store name is never a literal: the renderer adds `{{storeName}}` from the runtime config, so a flow that names the store declares it in `variables`. Money arrives already formatted; there is no currency variable. This file runs inside the production image without `apps/api`, so it imports nothing from there.

### 3. Add the compiled fallback

`apps/api/src/modules/mail/templates/order.placed.ts` exports `render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate` and builds the message from the helpers in `apps/api/src/modules/mail/templates/layout.ts`:

```ts
import type { MailBrand, MailLocale, RenderedTemplate } from '../mail.types';
import { ctaButton, escapeVars, monoId, renderLayout, renderText, TAX_INCLUDED } from './layout';

export function render(locale: MailLocale, vars: Vars, brand: MailBrand): RenderedTemplate {
```

`escapeVars` HTML-escapes every variable once, `monoId` wraps an identifier in the mono font, `ctaButton(href, label, locale)` draws the button, `renderLayout` puts the block inside the brand chrome and `renderText` produces the plain-text part. `apps/api/src/modules/mail/templates/registry.ts` maps the code to the function:

```ts
import { render as orderPlaced } from './order.placed';
```

`apps/api/src/modules/mail/templates/render.ts` is a two-tier resolver: the database row wins when its body is non-empty, the file renders when the row is missing, empty or fails to render. The registry is static so every job name is type-checked to have a fallback.

### 4. Bind the event

`apps/api/src/modules/mail/dispatch/dispatch.table.ts`:

```ts
export const DISPATCH_TABLE: DispatchEntry[] = [
  dispatchEntry(ORDER_EVENTS.CREATED, 'order.placed', resolveOrder),
  dispatchEntry(ORDER_EVENTS.SHIPPED, 'order.shipped', resolveOrder),
  dispatchEntry(RETURN_EVENTS.CREATED, 'return.requested', resolveReturn),
```

One row per flow. `MailDispatchListener` binds one EventEmitter2 listener per row; the resolver in `resolvers.ts` loads the entity and returns the recipient, the locale and the variables. Event names come from the emitting module's own constants, so a rename cannot silently unbind a flow.

### 5. Seed the row

`prisma/seed.ts`, in `seedNotificationTemplates`:

```ts
    {
      code: 'order.placed',
      event: 'order.created',
    },
```

The list carries routing only: `code`, `event`, and optionally `category` and `isLocked`. Subject, body and variables come from `TEMPLATE_DEFAULTS`, cut down to `default` plus the store's enabled locales. The upsert's `update: {}` never overwrites an operator edit; `npm run db:backfill-templates` repairs rows seeded blank. The seed runs this on the prod-safe `SEED_SCOPE=notifications-rbac` path too.

### 6. The token allow-list

Every `{{token}}` in a subject or body must be declared in the flow's `variables`. `apps/api/src/modules/notifications/notification-templates.service.ts`:

```ts
    const unknown = [...used].filter((token) => !allowed.has(token));
    if (unknown.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'UNKNOWN_TEMPLATE_TOKEN',
          message: `Template references undeclared variable(s): ${unknown.join(', ')}. Add them to the flow's variables list or remove the token.`,
          details: { unknown },
        },
      });
    }
```

The guard runs on create, on any update that touches subject or body, and on preview. Bodies are sanitized on save with the email HTML allowlist. An email template requires a subject; `sms` and `push` refuse one.

### 7. Preview and test send

`POST /v1/admin/notifications/templates/:id/preview` renders a draft for every locale through the real pipeline and persists nothing. `POST /v1/admin/notifications/templates/:id/send-test` enqueues a real send to the calling admin's own inbox:

```ts
    if (template.channel !== 'email') {
      throw new BadRequestException({
        error: {
          code: 'TEST_SEND_EMAIL_ONLY',
          message: `Only email templates can be test-sent (this one is "${template.channel}")`,
        },
      });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, locale: true },
    });
    if (!user?.email) {
      throw new BadRequestException({
        error: {
          code: 'TEST_SEND_NO_RECIPIENT',
          message: 'Your account has no email address to send a test to',
        },
      });
    }
```

The response reports the honest outcome: `queued`, `suppressed` or `skipped`. Every declared variable renders as a visible `[name]` placeholder unless the body supplies a sample.

### 8. How it sends

`MailService.enqueue` in `apps/api/src/modules/mail/mail.service.ts` checks, in order: a dedupe key against the BullMQ `mail` queue, the recipient's suppression row, the flow's `sendEnabled` flag and the global `notifications.pauseAll` setting. Each refusal writes a `NotificationLog` row with its status and never drops silently. `apps/api/src/modules/mail/mail.processor.ts` renders and sends through Resend at four workers and five jobs per second; the Resend webhook later moves the log row to `delivered`, `bounced` or `complained`.

## Tests to run

```bash
npx nx test api
npm run test:notification-defaults
npm run test:e2e
```

`npx nx test api` runs `notification-templates.service.spec.ts`, the renderer specs under `apps/api/src/modules/mail/templates/` and `mail.service.spec.ts`. `npm run test:notification-defaults` runs `prisma/__tests__/notification-template-defaults.spec.ts`, which checks the defaults file against the flow list and enforces language rules on the copy (lines 39-45 define the markers, lines 329-360 apply them):

- the `fr` subject and body must each match a French function word (`le`, `la`, `de`, `votre`, `vous`, `est`, `et`, `pour`, ...) or a diacritic (`é`, `è`, `à`, `ç`, ...);
- the `ar` subject and body must contain Arabic script, and the `fr` and `en` copy must contain none;
- the `en` subject and body must trip no French marker, so an English subject cannot carry a stray accent or a word such as `des` or `chez`.

Subjects that pass, one per locale: `Commande {{orderNumber}} reçue · {{storeName}}`, `Order {{orderNumber}} received · {{storeName}}`, `تم استلام الطلب {{orderNumber}} · {{storeName}}`. The only exemption is `contact-form`, whose subject is the sender's own line and must be byte-identical in all three locales. `npm run test:e2e` runs `apps/api/test/notifications.e2e-spec.ts`: the kill-switch, the locked-flow refusal, the resend path and the seeded bodies.

## Gotchas

- Flows whose code starts with `auth.` or `order.` are locked: `isLockedFlow` in `apps/api/src/modules/mail/mail.constants.ts` refuses `sendEnabled: false` and the pause switch skips them. The comment there names three places the lock rule lives; a new locked family goes into all three.
- Seeded rows store locale keys without a `default` key. The editor's `asTranslatable` keeps whatever keys the object holds; a `'default' in v` guard used to blank the subject.
- A Translatable body refuses a locale the store has not enabled. The seed cuts the defaults down to the enabled set for that reason, and an editor that round-trips a stale extra locale gets a 400.
- Test send bypasses the consent gate so a `LIFECYCLE` or `MARKETING` flow can be checked, but suppression and the pause switch still apply, so `suppressed` and `skipped` are real answers.
- A resend of an `auth.*` flow is refused: the single-use credential was redacted from the stored variables and would render as a broken link.
- The compiled file template is a plain template literal with no interpolator. It escapes at its own call site; the database tier escapes in `interpolate`. Both escape the same five characters.
- `MailJobName`, `MAIL_FLOW_CODES`, the registry and the seed list are four copies of the same list. The type-check and `npm run test:notification-defaults` catch three of the drifts; the seed list is checked by the e2e "every flow has non-empty bodies" case.
