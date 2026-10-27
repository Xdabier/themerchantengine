// Re-export the canonical resolver error classes from libs/shared so
// consumers across modules see the same `instanceof` identity. Source of
// truth: `libs/shared/common/src/asset-variants/resolver.ts`.
export {
  AssetFailedError,
  AssetNotReadyError,
  AssetVariantMissingError,
} from '@common/asset-variants';
