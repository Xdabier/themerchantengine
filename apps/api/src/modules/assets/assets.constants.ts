export const IMAGE_PROCESSING_QUEUE = 'asset-image-processing';
export const VIDEO_PROCESSING_QUEUE = 'asset-video-processing';

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');

/** Default max upload size (bytes). Overridden by MAX_ASSET_SIZE_MB env var. */
export const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** MIME types accepted at upload time. Magic bytes must also match. */
export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
]);

/**
 * Image variant sizes. Re-exported from the shared library, which is where they
 * live so the seed's image pipeline can render the same widths without
 * importing from `apps/api` (plan E2.6).
 */
export { IMAGE_VARIANTS } from '@common/asset-variants';

/** Image MIME types — used by callers that need to distinguish IMAGE from VIDEO uploads. */
export const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

/** Admin signed-URL TTL for original access — `agent_docs/assets-pipeline.md` §3. */
export const ADMIN_ORIGINAL_URL_TTL_SECONDS = 5 * 60;

/**
 * Video rendition set (AV2) — see `agent_docs/assets-pipeline.md` §5.
 * `cap` is the maximum output height in pixels (the encoder preserves aspect
 * ratio via FFmpeg's `scale=-2:{cap}` filter). `bitrate` is target average
 * video bitrate; `audio` is the audio codec + target bitrate.
 *
 * AV3 — names imported from the shared schema so the schema, the
 * processor, and the projection share exactly one source of truth (per
 * AV2 nit #2 carry-forward). Adding a rendition is a one-line change in
 * `libs/shared/common/src/asset-variants/asset-variants.schema.ts` plus
 * the metadata row here, and TypeScript fails the build if the two go
 * out of sync.
 */
// Relative path so the seed runner (`prisma/seed.ts` via `ts-node`) — which
// transitively imports this file through the e2e catalogue seed pipeline — can
// resolve the canonical names without a `tsconfig-paths/register` shim. The
// path-aliased equivalent (`@common/asset-variants`) resolves identically
// inside the API runtime.
import { VIDEO_RENDITION_NAMES, VideoRenditionName } from '@common/asset-variants';

type VideoRenditionMetadata = {
  name: VideoRenditionName;
  container: 'mp4' | 'webm';
  codec: string;
  cap: number;
  bitrate: string;
  audio: string;
};

// `Record<VideoRenditionName, ...>` enforces compile-time exhaustiveness:
// adding or removing a name in `VIDEO_RENDITION_NAMES` (the shared schema
// source) without updating this object fails the build, and unknown names
// here also fail the build.
const VIDEO_RENDITION_BY_NAME: Record<VideoRenditionName, VideoRenditionMetadata> = {
  mobile: {
    name: 'mobile',
    container: 'mp4',
    codec: 'h264-baseline',
    cap: 480,
    bitrate: '1.0M',
    audio: 'aac-96k',
  },
  tablet: {
    name: 'tablet',
    container: 'mp4',
    codec: 'h264-main',
    cap: 720,
    bitrate: '2.5M',
    audio: 'aac-128k',
  },
  desktop: {
    name: 'desktop',
    container: 'mp4',
    codec: 'h264-high',
    cap: 1080,
    bitrate: '5.0M',
    audio: 'aac-160k',
  },
  'desktop-webm': {
    name: 'desktop-webm',
    container: 'webm',
    codec: 'vp9',
    cap: 1080,
    bitrate: '5.0M',
    audio: 'opus-128k',
  },
};

// Order mirrors `VIDEO_RENDITION_NAMES` so iteration order is deterministic
// and stays aligned with the schema's declared order.
export const VIDEO_RENDITIONS: ReadonlyArray<VideoRenditionMetadata> = VIDEO_RENDITION_NAMES.map(
  (n) => VIDEO_RENDITION_BY_NAME[n],
);

export type VideoRendition = VideoRenditionMetadata;

/**
 * Fraction of total duration at which the poster frame is extracted —
 * 25 % per `agent_docs/assets-pipeline.md` §5. The processor seeks to
 * `duration * VIDEO_POSTER_FRAME_FRACTION` and writes that single frame
 * out as webp + avif at each `IMAGE_VARIANTS` width.
 */
export const VIDEO_POSTER_FRAME_FRACTION = 0.25;
