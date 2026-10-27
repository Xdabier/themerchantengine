---
title: Release your fork
description: 'What npm run release checks, builds, archives and tags, what the tarball holds and leaves out, the version and changelog convention it enforces, and how to keep a fork rebased on an upstream release tag without losing your seeds and env examples.'
primaryQuery: release fork self-hosted ecommerce git archive tarball
updated: 2026-09-09
schema: TechArticle
---

A release of the engine is a git tag plus a tarball an operator can install from with nothing but Node and Docker. `npm run release` cuts one from a clean checkout; it decides nothing about the version, it reads the version you set and refuses to continue when the tree, the changelog or the tag does not match it. This page reads `scripts/release.mjs` step by step, then shows how a fork stays on top of upstream releases.

## What `npm run release` does

The script is `scripts/release.mjs`, driven by `scripts/__tests__/release.spec.ts` against a scratch repository. It runs from the repository root and stops at the first refusal, each of which prints what to do:

- The current directory must be the git top level. Anywhere else: `Run the release from the repository root.`
- `package.json` must carry a semantic version (`1.2.0`, or `1.2.0-rc.1`). The tag is `v` plus that version.
- `git status --porcelain` must be empty. The tarball archives `HEAD`, so an uncommitted change would be a release nobody can reproduce.
- The first `## ` section of `CHANGELOG.md` must be titled with that version. `## [1.2.0]` and `## v1.2.0` are accepted; `## Unreleased` above the version's section is not, because a newer entry left under a working title would ship under the old notes. The refusal reads `CHANGELOG.md's first section is "## Unreleased", not "## 1.2.0"`.
- The tag must not exist yet. Bump the version or delete a tag cut by mistake.

Then it prints the plan: the commit, the bundle path, the tarball path and the tag. With `--dry-run` it stops here, having written nothing and built nothing. Without it:

1. `npm run build:setup` bundles the install stepper to `tools/setup/dist/index.js` (`tools/setup/build.mjs`); everything the stepper imports is inlined, so a box runs it with Node alone.
2. `git archive --format=tar HEAD` writes a tar, and the bundle is appended to it at `tools/setup/dist/index.js` with its modification time set to now. The archive is never extracted and repacked, so the exec bits git records, such as the one on `setup.sh`, survive a release cut on Windows. The wrapper `setup.sh` rebuilds the stepper when any file under `tools/setup/src`, `tools/setup/build.mjs` or `libs/shared/common/src` is newer than the bundle, and `git archive` stamps every file with the commit time, so the fresh stamp is what stops a tarball user's first `./setup.sh` from trying to build.
3. The tar is gzipped to `dist/release/themerchantengine-v<version>.tar.gz`. The bundle entry is owned by root, so the name of the user who cut the release is not in it. `--out <dir>` moves the directory; `dist/` is git-ignored.
4. An annotated tag `v<version>` is created, unless `--no-tag`.

The closing lines are the two steps it leaves to you:

```bash
git push origin v1.2.0
# attach dist/release/themerchantengine-v1.2.0.tar.gz to the v1.2.0 release on the repository host
```

The flags: `--dry-run` runs the checks and prints the plan; `--no-tag` writes the tarball without tagging; `--out <dir>` sets the tarball directory.

## What the tarball holds and what it leaves out

Only tracked files are archived. No `.env` file, no `.setup-state.json`, no `node_modules`, no build output other than the one stepper bundle can travel, whatever is lying in the working tree. `scripts/__tests__/release.spec.ts` asserts that on a scratch repository that has all three planted.

`.gitattributes` then marks what `git archive` drops with `export-ignore`, and its export-ignore block is the list of record. At this commit it drops:

- the project's planning record, its agent configuration and agent instructions, and the session runner state
- the fingerprint list of past secret-scan findings (`.gitleaksignore`)
- the security audits and the audit directory under `docs/`
- the manual QA records, the studio brand book, and the marketing and research notes under `docs/`, plus a third-party PDF report
- the token table and the spec of the client-reference guard, because the table names past clients
- the specs that read the agent configuration or that token table, which would fail on a tree without them
- `test/fixtures/license/private.pem`, a guard against a key put back by hand

The same spec runs `git archive` on the real repository and refuses any of those paths in the listing. It requires `setup.sh`, `setup.ps1`, `tools/setup/build.mjs`, `deploy/templates/compose.local.yml`, `prisma/schema.prisma` and `ci/answers.local.json` (placeholder answers the CI workflow installs from) to be present, and checks that the anchored root patterns keep `scripts/ci/` and nested `specs` directories in. It also fails when a shipped spec reads a path the archive leaves out.

So a release tarball holds the three applications, the shared libraries, `prisma/` with the schema, the seeds and the index SQL, `deploy/` with the templates and the operator manual, `docs/` less the files above (this documentation included), `scripts/` less the guard files above, `ci/` with the placeholder answers, `test/` with the fixtures, the two wrappers, the built stepper, `LICENSE`, `NOTICE`, `CHANGELOG.md` and `README.md`. On that tree `npm run verify:no-client-refs` reports that its token table is not there and that the gate runs in the engine repository only; every other gate on [Testing and gates](./testing-and-gates.md) runs, less the specs that check the agent configuration.

If your fork adds files that must not reach a customer, add them to `.gitattributes` with `export-ignore` and extend the `forbidden` pattern in `scripts/__tests__/release.spec.ts`, so the archive spec fails when the attribute is lost.

## Version and changelog convention

- The version is the `version` field of `package.json`, semantic, and a person sets it. The script does not bump.
- `CHANGELOG.md` opens with the project name as its `# ` heading, then one `## <version>` section per release, newest first, with `### Major Changes`, `### Minor Changes` and `### Patch Changes` subsections as the release needs them. Changesets is wired (`npm run changeset`, `npm run changeset:version`, config in `.changeset/config.json`), and `changeset version` writes a section in that shape and bumps `package.json` together, which is why the refusal names it as one way to title the entry.
- While work is in progress the top section may be titled `## Unreleased`. Retitle it with the version, commit, and only then run the release. The script's dry run is the cheapest way to check the three files agree: `npm run release -- --dry-run`.
- A release that changes the schema destructively says so in its entry. An operator reads the entry before an update, because the installer's schema push is additive and there is no automated schema rollback; [Update the store](../operate/update.md) explains the operator's side.

## Keep a fork on a release tag

A fork carries its own seeds, its own env examples and its own templates on top of the engine. Rebase it on upstream tags, not on a moving branch, so what you ship is a known release plus your commits.

```bash
git remote add upstream https://github.com/<upstream-owner>/themerchantengine.git
git fetch upstream --tags
git checkout -b rebase/v1.2.0 my-fork-main
git rebase v1.2.0
```

Conflicts land in the files a fork edits most. Resolve each one and continue with `git rebase --continue`:

- `prisma/seed.ts` and `prisma/seeds/` (`store-config/`, `fixture-catalogue/`, `demo-dashboard.ts`): keep upstream's new rows and your values. The seeds upsert and never overwrite a row an operator changed, so a merged seed is safe to re-run on an installed store.
- `prisma/permission-catalogue.ts` and `prisma/notification-template-defaults.ts`: a new upstream permission or template is a row your store needs; keep both sides.
- `.env.example` and `.env.production.example`: keep every new upstream variable, with your defaults. The installer rewrites the rendered env file from its answers on every run, so a value that must survive belongs in `deploy/templates/`, not in a hand edit on the box.
- `deploy/templates/nginx/` and the four `compose.*.yml` templates: a hand-edited vhost is lost on the next setup run, so this is where a fork's edge change lives. After a merge, `npm run test:scripts` runs `scripts/__tests__/edge-headers.spec.ts` and `scripts/__tests__/storefront-proxy.spec.ts` against the result, and the CI job `nginx-templates` parses every rendered vhost.
- `CHANGELOG.md`: keep upstream's sections and add your fork's entry as the first section when you cut your own release.

Then bring your development database and your build up to the new tree:

```bash
npm ci
npx prisma generate
npm run db:push          # prisma db push, then the search index, then the order-history backfill
npm run db:fts           # after any bare prisma db push you ran by hand
```

The installer and the test harnesses push the schema with `prisma db push`; they do not replay `prisma/migrations/`, and `prisma migrate dev` cannot replay them either, because the chain does not start from an empty database (see [Add a model](./recipes/data/add-a-model.md)). After a rebase, run `npm run db:push` and then `npm run db:fts`, because the search column, its trigger and its indexes live in `prisma/search_fts_setup.sql` and every push that touches the product table leaves them to be re-applied. A version bump in `package.json` also changes the `info.version` of the two generated OpenAPI documents under `docs/site/reference/_generated/`, so run `npm run docs:generate` and commit the result with the bump, or the `docs-generate-check` job refuses the push.

Run the gates before the rebase branch replaces your main branch: the per-application commands on [Testing and gates](./testing-and-gates.md), `npm run verify:no-client-refs` if your fork keeps the token table, and `npm run release -- --dry-run`. On an installed store the update is a re-run of the installer on the new checkout, engine box first; [Update the store](../operate/update.md) has the order and the by-hand steps.

## What a fork carries

The engine is MIT. Keep the `LICENSE` and `NOTICE` files at the repository root: they ship in every tarball your fork cuts, and the MIT terms ask that the copyright notice travel with every copy. The MIT License covers the code, not the engine's name or logo, so give your fork its own brand.
