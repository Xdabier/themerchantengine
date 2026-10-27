import { getLocaleDefinition, registerScratchLocale, registryLocaleCodes } from '@common/locale';
import { searchTextConfigs } from './search-text-configs';

const names = () => searchTextConfigs().map((entry) => entry.config);

describe('searchTextConfigs', () => {
  it('lists the registry text-search configs, each once, plus simple for tags', () => {
    expect(names()).toEqual(expect.arrayContaining(['english', 'french', 'arabic', 'simple']));
    expect(new Set(names()).size).toBe(names().length);
  });

  it('strips accents for ltr configs and leaves Arabic untouched', () => {
    const byName = Object.fromEntries(searchTextConfigs().map((e) => [e.config, e.unaccent]));
    expect(byName.arabic).toBe(false);
    expect(byName.french).toBe(true);
    expect(byName.simple).toBe(true);
  });

  it('canary: follows the registry, so a newly registered locale is covered', () => {
    const restore = registerScratchLocale('zz', 'ltr');
    try {
      expect(registryLocaleCodes()).toContain('zz');
      for (const code of registryLocaleCodes()) {
        expect(names()).toContain(getLocaleDefinition(code)?.textSearchConfig);
      }
    } finally {
      restore();
    }
  });

  it('only returns plain identifiers', () => {
    for (const config of names()) {
      expect(config).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
