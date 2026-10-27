/**
 * The seeds that read the runtime store config (DR-31, plan E1.4): tax,
 * shipping and the first payment method. `prisma/seed.ts` calls them on both
 * of its paths, so relative imports only: the seed runs in the slim production
 * image, which ships no `apps/api` source.
 */
export * from './tax';
export * from './shipping';
export * from './payment-methods';
export * from './home-sections';
