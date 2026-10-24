# docs/site

The public documentation of the engine. Every file here is rendered onto
themerchantengine.com by the site repository, which copies this directory at a
named git ref and never edits a page. A fix goes here and is pulled again.

- One directory per track: `getting-started`, `operate`, `customize`,
  `build-a-storefront`, `reference`. `_meta.json` names the tracks in the order
  the site shows them and carries the version label and the counts the landing
  page reads.
- Every track has a `_sidebar.json` listing its pages in order. A page absent
  from the sidebar is not rendered, so adding a page means adding it there too.
- Every page opens with frontmatter: `title`, `description`, `primaryQuery`,
  `updated` (the date the content last changed, not the date the file was
  touched), and `schema` (`TechArticle`, `HowTo` or `FAQPage`).
- The body has no `# ` heading. The title comes from the frontmatter and the
  renderer emits the `<h1>`.
- This directory ships in the release tarball. It is public: no client name, no
  reference to a plan, a phase or a decision record, and no internal path a
  reader cannot open. `npm run verify:no-client-refs` scans it with the rest of
  the tree.
- A recipe page (any page under `customize/recipes/`) carries exactly five
  `## ` headings, in this order: When you need this, Files you touch, The
  pattern, Tests to run, Gotchas. Sub-headings under them are fine.
- A numbered flow page (any `NN-*.md` under `build-a-storefront/`) carries the
  five `## ` headings The request, The response, Error codes, Every locale,
  Framework notes, in this order. Another `## ` heading may sit between or
  after them, and sub-headings under them are fine.
- Every repository path a page names in backticks must exist in the tree (or
  be a path git ignores, like `.env.production`), so a renamed file turns the
  page red instead of stale.
- The whole of `reference/` is written by `npm run docs:generate` from the
  code and committed: the OpenAPI export, the env examples, the permission and
  error-code catalogues, the store-config and answers schemas and the
  changelog. Nothing there is edited by hand; every file opens with the
  generator's marker and CI regenerates the tree and fails on a difference.
- Every file under `reference/` that is not JSON and not Markdown (the REST
  Client `.http` file) opens with the generator's marker as a `#` comment on
  its first line; a JSON file carries it as its first key, `x-generated-by`.
- `scripts/__tests__/docs-site.spec.ts` enforces each rule above with a
  planted canary per rule; `npm run test:scripts` runs it.
