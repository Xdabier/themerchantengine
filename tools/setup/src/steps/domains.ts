import * as path from 'node:path';
import {
  LICENSE_PUBLIC_KEY_PEM,
  hostOf,
  verifyLicenseFile,
} from '../../../../libs/shared/common/src/license';
import { ui } from '../cli/ui';
import { StepFailed, isAnyOrigin, isEmail, isHttpsOrigin, type Step } from './types';

export const LOCAL_ORIGINS = {
  storefront: 'http://localhost:53300',
  admin: 'http://localhost:53200',
  api: 'http://localhost:53000',
} as const;

/**
 * The public origins (plan E4.3) and, on a server profile, the proof that each
 * hostname resolves to this box before certbot is asked for a certificate it
 * would fail to issue. The license binding is checked here too, against the
 * hosts just entered.
 */
export const domainsStep: Step = {
  id: 'domains',
  title: 'Domains',
  async run(ctx) {
    const profile = ctx.answers.profile;
    const domains = ctx.answers.domains ?? {};
    if (profile === 'local') {
      ctx.answers.domains = { ...domains, ...LOCAL_ORIGINS };
      ui.note(ctx.out, `local profile: ${Object.values(LOCAL_ORIGINS).join(', ')}`);
      return;
    }
    const origin = (key: 'storefront' | 'admin' | 'api', label: string, initial?: string) =>
      ctx.prompter.text({
        path: `domains.${key}`,
        label,
        initial: domains[key] ?? initial,
        validate: (v) =>
          isHttpsOrigin(v) ? null : 'an https origin with no path, https://shop.example',
      });
    const storefront = await origin('storefront', 'Storefront origin');
    const apex = hostOf(storefront) ?? '';
    const admin = await origin('admin', 'Admin origin', `https://admin.${apex}`);
    const api = await origin('api', 'API origin', `https://api.${apex}`);
    const certbotEmail = await ctx.prompter.text({
      path: 'domains.certbotEmail',
      label: "Email for Let's Encrypt expiry notices",
      initial: domains.certbotEmail ?? ctx.answers.identity?.contactEmail,
      validate: (v) => (isEmail(v) ? null : 'not an email address'),
    });
    ctx.answers.domains = { ...domains, storefront, admin, api, certbotEmail };

    // Which hosts this box must answer on depends on what it runs.
    const served =
      profile === 'storefront'
        ? [storefront]
        : profile === 'engine'
          ? [admin, api]
          : [storefront, admin, api];
    const hosts = served.map((o) => hostOf(o) ?? '').filter(Boolean);
    const box = await ctx.ports.publicAddresses();
    for (const host of hosts) {
      const resolved = await ctx.ports.resolveHost(host);
      if (resolved.length === 0) {
        throw new StepFailed(
          'domains',
          `${host} does not resolve; add its DNS record and run setup again`,
        );
      }
      if (box.length > 0 && !resolved.some((ip) => box.includes(ip))) {
        throw new StepFailed(
          'domains',
          `${host} resolves to ${resolved.join(', ')} but this box answers on ${box.join(', ')}; point the record here and run setup again`,
        );
      }
      ui.ok(ctx.out, `${host} resolves to this box`);
    }
    if (profile === 'storefront') {
      const apiUrl = await ctx.prompter.text({
        path: 'engine.apiUrl',
        label: 'Public API origin of the engine box',
        initial: ctx.answers.engine?.apiUrl ?? api,
        validate: (v) => (isAnyOrigin(v) ? null : 'an origin with no path'),
      });
      // The engine box prints where to find it at the end of its own install;
      // it must match byte for byte or the storefront cache never invalidates.
      const revalidateSecret = await ctx.prompter.secret({
        path: 'engine.revalidateSecret',
        label: "The engine's STOREFRONT_REVALIDATE_SECRET (from the engine box's .env.production)",
        initial: ctx.answers.engine?.revalidateSecret,
        validate: (v) => (/^[0-9a-f]{64}$/.test(v) ? null : 'the value is 64 hex characters'),
      });
      ctx.answers.engine = { ...(ctx.answers.engine ?? {}), apiUrl, revalidateSecret };
    }

    const file = ctx.answers.license?.file;
    if (file) {
      const allHosts = [storefront, admin, api].map((o) => hostOf(o) ?? '').filter(Boolean);
      const verdict = verifyLicenseFile(
        ctx.ports.readFile(path.resolve(ctx.root, file)),
        allHosts,
        LICENSE_PUBLIC_KEY_PEM,
        ctx.ports.now(),
      );
      if (verdict.status === 'invalid') {
        throw new StepFailed('domains', verdict.reason ?? 'the license does not cover these hosts');
      }
      ui.ok(ctx.out, 'the license covers every host entered');
    }
  },
};
