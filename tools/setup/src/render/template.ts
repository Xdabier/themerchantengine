import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The template renderer for every deploy artefact (plan E4.4). `{{KEY}}` is
 * the only syntax. Strict on both sides: a placeholder no variable fills
 * fails the render, and a variable no placeholder consumes fails it too, so a
 * template that grows a new placeholder cannot ship half-rendered and a
 * renamed variable cannot silently stop reaching its file.
 */
export const TEMPLATES_DIR = path.join('deploy', 'templates');

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export class TemplateError extends Error {}

export function renderTemplate(
  template: string,
  vars: Readonly<Record<string, string>>,
  name = 'template',
): string {
  const used = new Set<string>();
  const missing = new Set<string>();
  const out = template.replace(PLACEHOLDER, (_whole, key: string) => {
    if (!(key in vars)) {
      missing.add(key);
      return '';
    }
    used.add(key);
    return vars[key];
  });
  if (missing.size > 0) {
    throw new TemplateError(`${name}: no value for {{${[...missing].join('}}, {{')}}}`);
  }
  const unused = Object.keys(vars).filter((key) => !used.has(key));
  if (unused.length > 0) {
    throw new TemplateError(`${name}: ${unused.join(', ')} given but never used`);
  }
  // A placeholder that survived inside a value would ship as text. A value is
  // never a template, so refuse it rather than render it twice.
  const leftover = out.match(PLACEHOLDER);
  if (leftover) {
    throw new TemplateError(`${name}: a value carries a placeholder (${leftover[0]})`);
  }
  return out;
}

export function readTemplate(root: string, relative: string): string {
  const file = path.join(root, TEMPLATES_DIR, relative);
  if (!fs.existsSync(file)) throw new TemplateError(`no template at ${file}`);
  return fs.readFileSync(file, 'utf8');
}

/** Renders `deploy/templates/<relative>` with `vars`; the name in errors is the relative path. */
export function renderFile(
  root: string,
  relative: string,
  vars: Readonly<Record<string, string>>,
): string {
  return renderTemplate(readTemplate(root, relative), vars, relative);
}
