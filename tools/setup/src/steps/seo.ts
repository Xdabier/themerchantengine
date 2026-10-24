import * as path from 'node:path';
import { ui } from '../cli/ui';
import { StepFailed, type Step } from './types';

/**
 * Optional search-engine submission (plan E4.3): IndexNow, Bing Webmaster
 * and Google Search Console. Each is off unless the operator has the
 * credential, and each credential is verified live: the Bing key by a sites
 * call, the service account by a sitemaps list on the property.
 */
export const seoStep: Step = {
  id: 'seo',
  title: 'Search-engine submission (optional)',
  profiles: ['engine', 'both'],
  async run(ctx) {
    const seo = ctx.answers.seo ?? {};
    const indexNowKey = await ctx.prompter.text({
      path: 'seo.indexNowKey',
      label: 'IndexNow key (8 to 128 hex characters, or empty to skip)',
      initial: seo.indexNowKey ?? '',
      validate: (v) =>
        v === '' || /^[a-f0-9]{8,128}$/.test(v) ? null : 'lower-case hex, 8 to 128 characters',
    });
    const bingApiKey = await ctx.prompter.secret({
      path: 'seo.bingApiKey',
      label: 'Bing Webmaster API key (or empty to skip)',
      initial: seo.bingApiKey ?? '',
    });
    const gscServiceAccountFile = await ctx.prompter.text({
      path: 'seo.gscServiceAccountFile',
      label: 'Google service-account JSON file for Search Console (or empty to skip)',
      initial: seo.gscServiceAccountFile ?? '',
      validate: (v) =>
        v === '' || ctx.ports.fileExists(path.resolve(ctx.root, v)) ? null : `no file at ${v}`,
    });
    let gscSiteUrl = '';
    if (gscServiceAccountFile) {
      const apex = ctx.answers.domains?.storefront?.replace(/^https?:\/\//, '') ?? '';
      gscSiteUrl = await ctx.prompter.text({
        path: 'seo.gscSiteUrl',
        label: 'Search Console property (sc-domain:<domain> or https://<domain>/)',
        initial: seo.gscSiteUrl ?? (apex ? `sc-domain:${apex}` : undefined),
        validate: (v) =>
          /^(sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+\/)$/.test(v)
            ? null
            : 'sc-domain:shop.example or https://shop.example/',
      });
    }
    ctx.answers.seo = { indexNowKey, bingApiKey, gscServiceAccountFile, gscSiteUrl };

    if (ctx.dryRun) {
      ui.note(ctx.out, 'dry run: the submission checks are skipped');
      return;
    }
    if (bingApiKey) {
      try {
        const sites = await ctx.ports.bingListSites(bingApiKey);
        ui.ok(ctx.out, `Bing key accepted; ${sites.length} site(s) visible`);
      } catch (err) {
        throw new StepFailed('seo', (err as Error).message);
      }
    }
    if (gscServiceAccountFile) {
      try {
        const sitemaps = await ctx.ports.gscListSitemaps(
          ctx.ports.readFile(path.resolve(ctx.root, gscServiceAccountFile)),
          gscSiteUrl,
        );
        ui.ok(
          ctx.out,
          `Search Console reachable for ${gscSiteUrl}; ${sitemaps.length} sitemap(s) listed`,
        );
      } catch (err) {
        throw new StepFailed('seo', (err as Error).message);
      }
    }
    if (indexNowKey) ui.ok(ctx.out, 'IndexNow key recorded; the runner publishes the key file');
    if (!indexNowKey && !bingApiKey && !gscServiceAccountFile) {
      ui.note(ctx.out, 'no submission credentials; sitemaps and robots.txt still work');
    }
  },
};
