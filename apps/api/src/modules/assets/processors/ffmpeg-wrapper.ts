import ffmpeg from 'fluent-ffmpeg';

export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * AV2 — fluent-ffmpeg probe: reads input metadata. Used to derive output
 * width per rendition (height is capped, width preserves aspect via the
 * encoder's scale filter) and to seek to the 25%-of-duration poster frame.
 */
export async function probeVideo(inputPath: string): Promise<VideoProbe> {
  return new Promise<VideoProbe>((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);
      const stream = data?.streams?.find((s) => s.codec_type === 'video');
      const duration = data?.format?.duration;
      if (
        typeof duration !== 'number' ||
        !stream ||
        typeof stream.width !== 'number' ||
        typeof stream.height !== 'number'
      ) {
        return reject(new Error('ffprobe returned incomplete metadata'));
      }
      resolve({
        durationSeconds: duration,
        width: stream.width,
        height: stream.height,
      });
    });
  });
}

export interface TranscodeOptions {
  videoCodec: string; // e.g. 'libx264', 'libvpx-vp9'
  videoProfile?: string; // 'baseline' | 'main' | 'high' for h264
  videoBitrate: string; // e.g. '5000k'
  audioCodec: string; // e.g. 'aac', 'libopus'
  audioBitrate: string; // e.g. '160k'
  capHeight: number; // e.g. 1080
  format: 'mp4' | 'webm';
}

/**
 * AV2 — transcodes a single rendition. Width-preserving scale via
 * `scale=-2:{cap}` (FFmpeg auto-computes the even-numbered width to match
 * the cap height while preserving aspect ratio). Wrapper resolves on the
 * `end` event and rejects on `error`.
 */
export async function transcodeVideo(
  inputPath: string,
  outputPath: string,
  opts: TranscodeOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let cmd = ffmpeg(inputPath)
      .videoCodec(opts.videoCodec)
      .videoBitrate(opts.videoBitrate)
      .audioCodec(opts.audioCodec)
      .audioBitrate(opts.audioBitrate)
      .format(opts.format)
      .outputOptions([`-vf`, `scale=-2:${opts.capHeight}`]);
    if (opts.videoProfile) {
      cmd = cmd.outputOptions(['-profile:v', opts.videoProfile]);
    }
    cmd
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(outputPath);
  });
}

/**
 * AV2 — extracts a single frame at the given offset and writes it as a PNG.
 * The PNG is then re-encoded as webp + avif × four widths via sharp by the
 * caller. Wrapper resolves on `end` / rejects on `error`.
 */
export async function extractFrame(
  inputPath: string,
  outputPath: string,
  atSeconds: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(atSeconds)
      .frames(1)
      .format('image2')
      .videoCodec('png')
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(outputPath);
  });
}
