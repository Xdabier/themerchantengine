# Contributing

Thank you for helping. This page covers the local setup, the checks a change must pass, and how to send it.

By taking part you agree to follow the [code of conduct](CODE_OF_CONDUCT.md). To report a security problem, follow [SECURITY.md](SECURITY.md) and do not open a public issue.

## Before you start

- Open an issue first for anything larger than a small fix, so the approach is agreed before you write code.
- Keep one goal per pull request. A refactor and a feature go in separate pull requests.
- The [roadmap](ROADMAP.md) lists what is planned and which issues are open for contributors.

## Taking an issue

- Comment on the issue to claim it. The maintainer assigns it to you, usually the same day.
- One open claim per person at a time.
- A claim with no pull request or update after 7 days goes back to open. Ask for more time if you need it.
- If you used an AI tool, say so in the pull request. It is allowed. A pull request that does not match its issue is closed.

## Local setup

You need Node 22 (see `.nvmrc`), npm, Docker and Git.

```bash
npm install
npm run docker:up    # Postgres and Redis for dev and test
npm run db:push      # schema sync and full-text search setup
npm run db:seed      # demo catalogue
npx nx serve api     # http://localhost:53000
npx nx serve admin   # http://localhost:53200
npx nx serve storefront   # http://localhost:53300
```

- Copy `.env.example` to `.env` first. Every variable the code reads is listed there with a comment.
- Always use `npm run db:push`, never a bare `prisma db push`. The bare command drops the search column.
- The public tree installs no git hooks, because the hook scripts live in `.claude/`, which the release leaves out. Nothing checks a commit locally, so run the gate below before every push. CI runs on every push and pull request.

## Checks

Run the gate before you push:

```bash
npm run gate
```

It runs the guards, lint and unit tests for every affected project, and the script tests. Also run these when your change touches the matching area:

- Admin: `npx nx build admin --configuration=production`
- Storefront: `npx nx build storefront --configuration=production` and `npm run test:storefront-ssr-smoke`
- API endpoints: `npm run test:e2e`
- Admin or storefront journeys: `npx nx e2e admin-e2e --grep journey` or `npx nx e2e storefront-e2e --grep <name>`

Do not change a guard, lint rule or test config just to make a run pass. If a rule is wrong, say so in the pull request and change it in its own commit.

## Code style

- Files and directories in kebab-case, classes in PascalCase.
- Unit tests are `*.spec.ts`, backend e2e tests are `*.e2e-spec.ts`, and Playwright journeys are `*.journey.spec.ts`.
- No `any`. Narrow unknown input at the API boundary with Zod or class-validator.
- API responses use `{ data, meta? }` and errors use `{ error: { code, message, details? } }`.
- A bug fix starts with a test that fails without the fix.

## Commits

Commits follow the Angular convention:

```
type(scope): subject
```

- `type` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore` or `perf`.
- Keep the subject short and in plain English. Add a body only when the reason is not obvious.
- Stage files by path. Do not use `git add -A`.
- Add a changeset with `npm run changeset` when the change is visible to store operators.

## Pull requests

- Fill in the pull request template.
- Link the issue the change closes.
- Make sure `npm run gate` passes and CI is green.

## License of contributions

The engine is published under the [MIT License](LICENSE). Contributions are accepted under the same license: by sending one you confirm that you wrote it or have the right to submit it, and you agree that it is distributed under the MIT License. No sign-off line or contributor agreement is needed.
