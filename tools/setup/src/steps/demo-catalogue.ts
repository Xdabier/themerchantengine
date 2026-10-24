import { ui } from '../cli/ui';
import type { Step } from './types';

/**
 * The demo catalogue (plan E4.3): the brandless fixture catalogue the e2e
 * suites run on, offered by default on a local profile and off by default on
 * a server, where a client wants an empty store.
 */
export const demoCatalogueStep: Step = {
  id: 'demo-catalogue',
  title: 'Demo catalogue',
  profiles: ['engine', 'both', 'local'],
  async run(ctx) {
    const local = ctx.answers.profile === 'local';
    const demoCatalogue = await ctx.prompter.confirm({
      path: 'demoCatalogue',
      label: 'Seed the demo catalogue (products, categories, a customer, sample orders)?',
      initial: ctx.answers.demoCatalogue ?? local,
    });
    ctx.answers.demoCatalogue = demoCatalogue;
    if (demoCatalogue && !local) {
      ui.warn(
        ctx.out,
        'a server install with the demo catalogue serves fictional products until they are deleted',
      );
    }
  },
};
