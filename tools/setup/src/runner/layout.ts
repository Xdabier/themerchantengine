import * as path from 'node:path';
import { hostOf } from '../../../../libs/shared/common/src/license';
import type { SetupAnswers, SetupProfile } from '../answers';

/**
 * Where an install puts things, per profile (plan E4.4 to E4.6). One object
 * the runner steps read, so a path lives here once.
 */
export interface Layout {
  profile: SetupProfile;
  root: string;
  projectName: string;
  /** The compose project directory under deploy/. */
  dir: string;
  composeFile: string;
  /** The engine env file, when this profile runs the engine. */
  engineEnvFile: string | null;
  /** The storefront env file, when this profile runs the storefront. */
  storefrontEnvFile: string | null;
  /** The env file `--env-file` reads for compose interpolation. */
  composeEnvFile: string;
  configDir: string;
  nginxDir: string;
  indexNowDir: string;
  systemdDir: string;
  /** The hosts the edge serves TLS for, in the order their vhosts render. */
  tlsHosts: { host: string; template: 'api' | 'admin' | 'storefront' }[];
  /** Public origins for the smoke probes. */
  urls: { api: string; admin: string; storefront: string };
  runsEngine: boolean;
  runsStorefront: boolean;
  local: boolean;
  containers: { postgres: string; nginx: string };
}

/**
 * Also spelled by hand in setup.sh and setup.ps1, which look for running
 * containers named `themerchantengine-*` to tell a re-run from a conflict;
 * the wrappers cannot import this file. Change all three together.
 */
export const PROJECT_NAME = 'themerchantengine';
export const IMAGE_TAG = 'installed';
export const BACKUP_DIR = '/var/backups/themerchantengine';

export function layoutFor(answers: SetupAnswers, root: string): Layout {
  const profile = answers.profile;
  if (!profile) throw new Error('the profile was never answered');
  const domains = answers.domains ?? {};
  const api = domains.api ?? '';
  const admin = domains.admin ?? '';
  const storefront = domains.storefront ?? '';
  const local = profile === 'local';
  const runsEngine = profile !== 'storefront';
  const runsStorefront = profile !== 'engine';
  const dirName = profile === 'storefront' ? 'storefront' : local ? 'local' : 'engine';
  const dir = path.join(root, 'deploy', dirName);
  const engineEnvFile = runsEngine
    ? local
      ? path.join(dir, '.env')
      : path.join(root, '.env.production')
    : null;
  const storefrontEnvFile = runsStorefront
    ? local
      ? path.join(dir, '.env.storefront')
      : path.join(root, 'apps', 'storefront', '.env.production')
    : null;
  const tlsHosts: Layout['tlsHosts'] = [];
  if (!local) {
    if (runsEngine) {
      tlsHosts.push({ host: hostOf(api) ?? '', template: 'api' });
      tlsHosts.push({ host: hostOf(admin) ?? '', template: 'admin' });
    }
    if (runsStorefront) tlsHosts.push({ host: hostOf(storefront) ?? '', template: 'storefront' });
  }
  return {
    profile,
    root,
    projectName: PROJECT_NAME,
    dir,
    composeFile: path.join(dir, 'docker-compose.yml'),
    engineEnvFile,
    storefrontEnvFile,
    composeEnvFile: (engineEnvFile ?? storefrontEnvFile) as string,
    configDir: path.join(dir, 'config'),
    nginxDir: path.join(dir, 'nginx'),
    indexNowDir: path.join(dir, 'indexnow'),
    systemdDir: path.join(dir, 'systemd'),
    tlsHosts: tlsHosts.filter((h) => h.host),
    urls: { api, admin, storefront },
    runsEngine,
    runsStorefront,
    local,
    containers: { postgres: `${PROJECT_NAME}-postgres`, nginx: `${PROJECT_NAME}-edge` },
  };
}

/** Paths relative to the repository root, forward slashes, for compose files and messages. */
export function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
