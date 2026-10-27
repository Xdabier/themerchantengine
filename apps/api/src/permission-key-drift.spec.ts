import * as fs from 'fs';
import * as path from 'path';
import { PERMISSION_MODULES, PERMISSION_STRINGS } from '@permissions';

/**
 * Bidirectional drift guard for the permission catalogue.
 *
 * Forward: no controller may require a key the catalogue does not contain,
 * that key would be unticked-able from `/roles` and rejected by the DTOs, so
 * the route would be permanently unreachable for non-superadmins.
 *
 * Reverse: no catalogue module may exist without at least one enforcing route,
 * that is exactly how the ten dead modules (`tax`, `rbac`, `gift-cards`, ...)
 * reached the operator's screen and did nothing.
 */
const API_SRC = path.resolve(__dirname);

function collectControllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectControllerFiles(full, out);
    } else if (entry.name.endsWith('.controller.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface ExtractedKey {
  file: string;
  key: string;
}

function extractPermissionKeys(files: string[]): ExtractedKey[] {
  const out: ExtractedKey[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    // `@Permissions('a:b', 'c:d')`, possibly wrapped across lines.
    for (const call of source.matchAll(/@Permissions\(([\s\S]*?)\)/g)) {
      for (const arg of call[1].matchAll(/['"]([^'"]+)['"]/g)) {
        out.push({ file: path.relative(API_SRC, file).replace(/\\/g, '/'), key: arg[1] });
      }
    }
  }
  return out;
}

describe('permission key drift', () => {
  const controllerFiles = collectControllerFiles(API_SRC);
  const extracted = extractPermissionKeys(controllerFiles);

  it('finds controllers to scan (guards against a silently empty sweep)', () => {
    expect(controllerFiles.length).toBeGreaterThan(20);
    expect(extracted.length).toBeGreaterThan(100);
  });

  it('requires only keys that exist in the catalogue', () => {
    const catalogue = new Set<string>(PERMISSION_STRINGS);
    const offenders = extracted
      .filter((e) => !catalogue.has(e.key))
      .map((e) => `${e.file}: ${e.key}`);
    expect(offenders).toEqual([]);
  });

  it('leaves no catalogue module without an enforcing endpoint', () => {
    const enforced = new Set(extracted.map((e) => e.key.split(':')[0]));
    const orphans = PERMISSION_MODULES.filter((mod) => !enforced.has(mod));
    expect([...orphans]).toEqual([]);
  });
});
