## What this changes

A short description of the change and why it is needed.

Closes #

## How it was tested

- [ ] `npm run gate` passes
- [ ] A new or changed test covers the change (a bug fix starts with a failing test)
- [ ] Admin change: `npx nx build admin --configuration=production` passes
- [ ] Storefront change: `npx nx build storefront --configuration=production` and `npm run test:storefront-ssr-smoke` pass
- [ ] API endpoint change: `npm run test:e2e` passes

## Checklist

- [ ] Commits follow `type(scope): subject`
- [ ] A changeset is added when store operators will notice the change (`npm run changeset`)
- [ ] `.env.example` and the docs are updated when a setting is added or renamed
- [ ] No secrets, tokens or customer data in the diff
