import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read a storefront source file as raw text.
 *
 * For guards that must assert over the bytes rather than the rendered output:
 * editors hide C1 control characters and render an em-dash as a plain dash, so
 * a rule written over `textContent` cannot see either one (plan L, C4 and C2).
 *
 * The working directory differs between a bare `vitest` run at the workspace
 * root and an `nx test storefront` run, so both roots are probed.
 */
export function readStorefrontSource(relativePath: string): string {
  const roots = ['.', 'apps/storefront'];
  for (const root of roots) {
    try {
      return readFileSync(resolve(process.cwd(), root, relativePath), 'utf8');
    } catch {
      // Try the next root.
    }
  }
  throw new Error(`Storefront source not found on any known root: ${relativePath}`);
}
