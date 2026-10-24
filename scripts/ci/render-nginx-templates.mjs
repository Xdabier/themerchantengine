// Renders every nginx and compose template under deploy/templates/ with
// placeholder values so CI can parse the exact files an install would write.
//
//   node scripts/ci/render-nginx-templates.mjs <out-dir>
//
// Three sets come out:
//   <out>/server/            the TLS edge (00-http.conf plus the api, admin and storefront vhosts)
//   <out>/local/             the local profile's admin edge (10-admin.conf)
//   <out>/compose/<profile>/ each compose template as docker-compose.yml, with a stub .env
//
// The substitution is the stepper's own rule (tools/setup/src/render/template.ts):
// `{{KEY}}` only, a placeholder with no value fails, a value no placeholder uses
// fails, so a template that grows a placeholder cannot pass here half-rendered.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '..', '..');
const templatesDir = path.join(workspace, 'deploy', 'templates');

const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export function render(template, vars, name) {
  const used = new Set();
  const missing = new Set();
  const out = template.replace(PLACEHOLDER, (_whole, key) => {
    if (!(key in vars)) {
      missing.add(key);
      return '';
    }
    used.add(key);
    return vars[key];
  });
  if (missing.size > 0) throw new Error(`${name}: no value for {{${[...missing].join('}}, {{')}}}`);
  const unused = Object.keys(vars).filter((key) => !used.has(key));
  if (unused.length > 0) throw new Error(`${name}: ${unused.join(', ')} given but never used`);
  if (PLACEHOLDER.test(out)) throw new Error(`${name}: a placeholder survived the render`);
  return out;
}

const HOSTS = {
  storefront: 'store.example.test',
  admin: 'admin.store.example.test',
  api: 'api.store.example.test',
};

/** The nginx files an install writes, per edge, and the values a CI render fills them with. */
export const EDGES = {
  server: [
    {
      template: 'http.conf',
      file: '00-http.conf',
      vars: { HOSTS: `${HOSTS.storefront} www.${HOSTS.storefront} ${HOSTS.api} ${HOSTS.admin}` },
    },
    { template: 'api.conf', file: '10-api.conf', vars: { HOST: HOSTS.api } },
    { template: 'admin.conf', file: '10-admin.conf', vars: { HOST: HOSTS.admin } },
    {
      template: 'storefront.conf',
      file: '10-storefront.conf',
      vars: { HOST: HOSTS.storefront, API_UPSTREAM: `https://${HOSTS.api}`, API_HOST: HOSTS.api },
    },
  ],
  local: [
    { template: 'local-admin.conf', file: '10-admin.conf', vars: {} },
    { template: 'local-storefront.conf', file: '10-storefront.conf', vars: {} },
  ],
};

/** The compose templates, one per profile, with the values the stepper's layout would give them. */
export const COMPOSE = {
  engine: {
    PROJECT_NAME: 'themerchantengine',
    IMAGE_TAG: 'installed',
    ENV_FILE: '.env',
    ADMIN_HOST: HOSTS.admin,
    API_HOST: HOSTS.api,
  },
  storefront: {
    PROJECT_NAME: 'themerchantengine',
    IMAGE_TAG: 'installed',
    ENV_FILE: '.env',
    STOREFRONT_HOST: HOSTS.storefront,
    TURNSTILE_SITE_KEY: '',
  },
  both: {
    PROJECT_NAME: 'themerchantengine',
    IMAGE_TAG: 'installed',
    ENV_FILE: '.env',
    STOREFRONT_ENV_FILE: '.env.storefront',
    ADMIN_HOST: HOSTS.admin,
    API_HOST: HOSTS.api,
    STOREFRONT_HOST: HOSTS.storefront,
    TURNSTILE_SITE_KEY: '',
  },
  local: {
    PROJECT_NAME: 'themerchantengine',
    IMAGE_TAG: 'installed',
    ENV_FILE: '.env',
    STOREFRONT_ENV_FILE: '.env.storefront',
    TURNSTILE_SITE_KEY: '',
    API_USER: '1000:1000',
  },
};

/** What the rendered compose files interpolate from their env file. */
const STUB_ENV = 'DB_PASSWORD=stub\nREDIS_PASSWORD=stub\n';

export function renderAll(outDir, templates = templatesDir) {
  const nginxDir = path.join(templates, 'nginx');
  const expected = new Set(Object.values(EDGES).flatMap((edge) => edge.map((e) => e.template)));
  const present = fs.readdirSync(nginxDir).filter((f) => f.endsWith('.conf'));
  const unknown = present.filter((f) => !expected.has(f));
  if (unknown.length > 0) {
    throw new Error(`templates with no CI render entry, add them to EDGES: ${unknown.join(', ')}`);
  }
  const composePresent = fs
    .readdirSync(templates)
    .filter((f) => /^compose\..+\.yml$/.test(f))
    .map((f) => f.replace(/^compose\.(.+)\.yml$/, '$1'));
  const composeUnknown = composePresent.filter((p) => !(p in COMPOSE));
  if (composeUnknown.length > 0) {
    throw new Error(
      `compose templates with no CI render entry, add them to COMPOSE: ${composeUnknown.join(', ')}`,
    );
  }
  const written = [];
  for (const [edge, entries] of Object.entries(EDGES)) {
    const dir = path.join(outDir, edge);
    fs.mkdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const source = path.join(nginxDir, entry.template);
      const rendered = render(fs.readFileSync(source, 'utf8'), entry.vars, entry.template);
      const target = path.join(dir, entry.file);
      fs.writeFileSync(target, rendered);
      written.push(target);
    }
  }
  for (const [profile, vars] of Object.entries(COMPOSE)) {
    const dir = path.join(outDir, 'compose', profile);
    fs.mkdirSync(dir, { recursive: true });
    const name = `compose.${profile}.yml`;
    const rendered = render(fs.readFileSync(path.join(templates, name), 'utf8'), vars, name);
    const target = path.join(dir, 'docker-compose.yml');
    fs.writeFileSync(target, rendered);
    fs.writeFileSync(path.join(dir, '.env'), STUB_ENV);
    fs.writeFileSync(path.join(dir, '.env.storefront'), STUB_ENV);
    written.push(target);
  }
  return written;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2];
  if (!outDir) {
    process.stderr.write('usage: node scripts/ci/render-nginx-templates.mjs <out-dir>\n');
    process.exit(2);
  }
  for (const file of renderAll(path.resolve(outDir))) process.stdout.write(`${file}\n`);
}
