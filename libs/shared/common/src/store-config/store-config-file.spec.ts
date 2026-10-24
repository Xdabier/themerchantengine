import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadStoreConfigFixture, runtimeConfigOfFixture } from '../store-config-fixtures';
import {
  STORE_CONFIG_FILE_ENV,
  parseStoreConfigFile,
  readStoreConfigFile,
  storeConfigFromEnv,
} from './store-config-file';

describe('store config file', () => {
  const demo = runtimeConfigOfFixture(loadStoreConfigFixture('demo'));
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tme-cfg-file-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('parses a runtime config the strict schema accepts', () => {
    expect(parseStoreConfigFile(JSON.stringify(demo), 'demo')).toEqual(demo);
  });

  it('refuses text that is not JSON, and a config with an unknown key, naming the file', () => {
    expect(() => parseStoreConfigFile('nope', 'client.config.json')).toThrow(
      /client\.config\.json is not valid JSON/,
    );
    expect(() =>
      parseStoreConfigFile(JSON.stringify({ ...demo, extra: 1 }), 'client.config.json'),
    ).toThrow(/does not match the store config schema/);
  });

  it('reads the file STORE_CONFIG_FILE names and nothing when it is unset', () => {
    const file = path.join(dir, 'client.config.json');
    fs.writeFileSync(file, JSON.stringify(demo));
    expect(readStoreConfigFile(file)).toEqual(demo);
    expect(storeConfigFromEnv({ [STORE_CONFIG_FILE_ENV]: file })).toEqual(demo);
    expect(storeConfigFromEnv({})).toBeNull();
    expect(storeConfigFromEnv({ [STORE_CONFIG_FILE_ENV]: '' })).toBeNull();
  });
});
