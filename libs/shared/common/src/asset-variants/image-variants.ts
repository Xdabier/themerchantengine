/**
 * Image variant sizes, post-AV1 cutover (asset-variant-serving). The legacy
 * `original` entry was removed: full-resolution access goes through `large`
 * (1200 px), originals stay in private storage and are exposed only via the
 * admin signed-URL endpoint. See `agent_docs/assets-pipeline.md` §5.
 *
 * Here rather than in the API module because the seed's image pipeline renders
 * the same widths and must not reach into `apps/api` to learn them: everything
 * under `prisma/` has to run inside the runtime image, which carries the shared
 * library and not the API sources (plan E2.6, guarded by
 * `prisma/__tests__/seed-imports.spec.ts`).
 */
export const IMAGE_VARIANTS = [
  { name: 'thumbnail', width: 150 },
  { name: 'small', width: 400 },
  { name: 'medium', width: 800 },
  { name: 'large', width: 1200 },
] as const;
