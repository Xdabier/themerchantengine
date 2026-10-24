import * as path from 'node:path';
import {
  LICENSE_PUBLIC_KEY_PEM,
  verifyLicenseFile,
} from '../../../../libs/shared/common/src/license';
import { ui } from '../cli/ui';
import { StepFailed, type Step } from './types';

/**
 * The license file (plan E4.3, DR-31). The signature is checked against the
 * engine's baked key here, before anything is written; the domain binding is
 * checked again in the domains step once the domains are known, because this
 * step comes first in the plan's order and a host cannot be judged before it
 * is entered. Expiry is reported, never refused: a grace period exists so an
 * operator can install the file they were sent.
 *
 * A local profile may run unlicensed. The API never refuses to start on a
 * missing file (DR-34), but a server install is expected to carry one.
 */
export const licenseStep: Step = {
  id: 'license',
  title: 'License file',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const local = ctx.answers.profile === 'local';
    const file = await ctx.prompter.text({
      path: 'license.file',
      label: local
        ? 'Path of the license file (empty to run unlicensed)'
        : 'Path of the license file',
      initial: ctx.answers.license?.file ?? (local ? '' : undefined),
      hint: 'The signed JSON file issued for this store. Its domains must cover the hosts entered next.',
      validate: (value) => {
        if (value === '') return local ? null : 'a server install needs a license file';
        return ctx.ports.fileExists(path.resolve(ctx.root, value)) ? null : `no file at ${value}`;
      },
    });
    ctx.answers.license = { file };
    if (file === '') {
      ui.warn(ctx.out, 'running unlicensed; the admin will show the license as missing');
      return;
    }
    const content = ctx.ports.readFile(path.resolve(ctx.root, file));
    const verdict = verifyLicenseFile(content, [], LICENSE_PUBLIC_KEY_PEM, ctx.ports.now());
    if (verdict.status === 'invalid' || !verdict.claims) {
      throw new StepFailed('license', verdict.reason ?? 'the license did not verify');
    }
    ui.ok(
      ctx.out,
      `license ${verdict.claims.id} for ${verdict.claims.licensee}, plan ${verdict.claims.plan}, bound to ${verdict.claims.domains.join(', ')}`,
    );
    if (verdict.status !== 'valid') {
      ui.warn(
        ctx.out,
        `license status is ${verdict.status} (${verdict.daysToExpiry} days to expiry); the admin will show a banner`,
      );
    }
  },
};
