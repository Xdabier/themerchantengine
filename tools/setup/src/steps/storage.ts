import { ui } from '../cli/ui';
import { StepFailed, isAnyOrigin, type Step } from './types';

/**
 * Asset storage (plan E4.3): an S3-compatible bucket, proven live by a put,
 * a get and a delete of one probe object before the step passes. A local
 * profile writes to disk and asks nothing.
 *
 * A bucket name with a dot breaks virtual-host TLS on providers with a
 * single-label wildcard certificate, so the probe, like the API's driver,
 * switches to path-style addressing for those names.
 */
export const storageStep: Step = {
  id: 'storage',
  title: 'Asset storage',
  async run(ctx) {
    const storage = ctx.answers.storage ?? {};
    if (ctx.answers.profile === 'local') {
      ctx.answers.storage = { driver: 'local' };
      ui.note(ctx.out, 'local profile: assets are written to ./uploads on this machine');
      return;
    }
    if (ctx.answers.profile === 'storefront') return;

    const endpoint = await ctx.prompter.text({
      path: 'storage.endpoint',
      label: 'S3 endpoint (https://s3.<region>.example)',
      initial: storage.endpoint,
      validate: (v) => (isAnyOrigin(v) ? null : 'an origin with no path'),
    });
    const region = await ctx.prompter.text({
      path: 'storage.region',
      label: 'S3 region',
      initial: storage.region,
      validate: (v) => (v.length > 0 ? null : 'the region the endpoint serves'),
    });
    const bucket = await ctx.prompter.text({
      path: 'storage.bucket',
      label: 'Bucket name (hyphens, no dots)',
      initial: storage.bucket,
      validate: (v) => (/^[a-z0-9][a-z0-9.-]{1,62}$/.test(v) ? null : 'a valid bucket name'),
    });
    if (bucket.includes('.')) {
      ui.warn(
        ctx.out,
        'a dotted bucket name forces path-style URLs; browsers may refuse the certificate',
      );
    }
    const publicUrl = await ctx.prompter.text({
      path: 'storage.publicUrl',
      label: 'Public URL prefix the browser fetches assets from',
      initial: storage.publicUrl ?? `${endpoint.replace('://', `://${bucket}.`)}`,
      validate: (v) => (/^https?:\/\/[^\s]+$/.test(v) ? null : 'an http(s) URL'),
    });
    const accessKey = await ctx.prompter.secret({
      path: 'storage.accessKey',
      label: 'S3 access key',
      initial: storage.accessKey,
      validate: (v) => (v.length > 0 ? null : 'required'),
    });
    const secretKey = await ctx.prompter.secret({
      path: 'storage.secretKey',
      label: 'S3 secret key',
      initial: storage.secretKey,
      validate: (v) => (v.length > 0 ? null : 'required'),
    });
    ctx.answers.storage = {
      driver: 's3',
      endpoint,
      region,
      bucket,
      publicUrl: publicUrl.replace(/\/$/, ''),
      accessKey,
      secretKey,
    };
    if (ctx.dryRun) {
      ui.note(ctx.out, 'dry run: the S3 probe is skipped');
      return;
    }
    try {
      await ctx.ports.s3Probe({
        endpoint,
        region,
        bucket,
        accessKey,
        secretKey,
        forcePathStyle: bucket.includes('.'),
      });
    } catch (err) {
      throw new StepFailed('storage', (err as Error).message);
    }
    ui.ok(ctx.out, `bucket ${bucket}: put, get and delete of a probe object succeeded`);
  },
};
